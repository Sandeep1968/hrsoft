import "server-only";
import { z } from "zod";
import { Prisma, type UserStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sendMail } from "@/lib/mail";
import { env } from "@/lib/env";
import { hashPassword } from "@/lib/auth/password";
import { revokeAllSessions } from "@/lib/auth/session";
import { randomToken } from "@/lib/crypto";
import { paginate, paginationSchema, toPage, zUuid } from "@/lib/api";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { type Actor, authorize } from "@/lib/rbac/authorize";

// ── Schemas ────────────────────────────────────────────────────────────

export const listUsersSchema = paginationSchema.extend({
  status: z.enum(["INVITED", "ACTIVE", "SUSPENDED"]).optional(),
  roleKey: z.string().trim().max(40).optional(),
  hasEmployee: z.coerce.boolean().optional(),
});

export const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(2).max(120),
  roleKeys: z.array(z.string().trim().min(1).max(40)).min(1).max(10),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const userStatusSchema = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]) });
export const userIdSchema = zUuid;

// ── Helpers ────────────────────────────────────────────────────────────

/** 15-char temporary password that satisfies the password policy (letters + digits). */
export function generateTempPassword(): string {
  const digits = String(Math.floor(1000 + Math.random() * 9000));
  return `Tmp${randomToken(6).replace(/[-_]/g, "x")}${digits}`;
}

const userSelect = {
  id: true,
  email: true,
  name: true,
  image: true,
  status: true,
  lastLoginAt: true,
  mustChangePassword: true,
  emailVerifiedAt: true,
  createdAt: true,
  employee: { select: { id: true, employeeCode: true, displayName: true, status: true, department: { select: { name: true } } } },
  roles: { select: { role: { select: { id: true, key: true, name: true, isSystem: true } } } },
  _count: { select: { sessions: true, apiKeys: true } },
} satisfies Prisma.UserSelect;
type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

function serializeUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    image: u.image,
    status: u.status,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    mustChangePassword: u.mustChangePassword,
    emailVerified: !!u.emailVerifiedAt,
    createdAt: u.createdAt.toISOString(),
    employee: u.employee ? { id: u.employee.id, employeeCode: u.employee.employeeCode, displayName: u.employee.displayName, status: u.employee.status, department: u.employee.department?.name ?? null } : null,
    roles: u.roles.map((r) => r.role),
    sessionCount: u._count.sessions,
    apiKeyCount: u._count.apiKeys,
  };
}
export type UserDto = ReturnType<typeof serializeUser>;

async function loadUser(id: string) {
  const u = await db.user.findUnique({ where: { id }, select: userSelect });
  if (!u) throw new NotFoundError("User");
  return u;
}

async function assertNotLastSuperAdmin(userId: string, action: string) {
  const isSuper = await db.userRole.count({ where: { userId, role: { key: "SUPER_ADMIN" } } });
  if (!isSuper) return;
  const others = await db.userRole.count({ where: { role: { key: "SUPER_ADMIN" }, userId: { not: userId }, user: { status: "ACTIVE" } } });
  if (others === 0) throw new ConflictError(`Cannot ${action} the last active SUPER_ADMIN`);
}

// ── Queries ────────────────────────────────────────────────────────────

export async function listUsers(actor: Actor, p: z.infer<typeof listUsersSchema>) {
  await authorize(actor, "users:manage");
  const where: Prisma.UserWhereInput = {
    AND: [
      p.status ? { status: p.status } : {},
      p.roleKey ? { roles: { some: { role: { key: p.roleKey } } } } : {},
      p.hasEmployee === undefined ? {} : p.hasEmployee ? { employee: { isNot: null } } : { employee: null },
      p.q ? { OR: [{ email: { contains: p.q, mode: "insensitive" } }, { name: { contains: p.q, mode: "insensitive" } }, { employee: { employeeCode: { contains: p.q, mode: "insensitive" } } }] } : {},
    ],
  };
  const orderBy: Prisma.UserOrderByWithRelationInput = p.sort === "lastLoginAt" ? { lastLoginAt: { sort: p.order, nulls: "last" } } : p.sort === "email" ? { email: p.order } : p.sort === "createdAt" ? { createdAt: p.order } : { name: p.order };
  const [rows, total] = await Promise.all([db.user.findMany({ where, orderBy, ...paginate(p), select: userSelect }), db.user.count({ where })]);
  return toPage(rows.map(serializeUser), total, p);
}

export async function getUser(actor: Actor, id: string) {
  await authorize(actor, "users:manage");
  return serializeUser(await loadUser(id));
}

export async function userStats(actor: Actor) {
  await authorize(actor, "users:manage");
  const [byStatus, noEmployee, mustChange] = await Promise.all([db.user.groupBy({ by: ["status"], _count: { _all: true } }), db.user.count({ where: { employee: null } }), db.user.count({ where: { mustChangePassword: true } })]);
  const counts: Record<UserStatus, number> = { INVITED: 0, ACTIVE: 0, SUSPENDED: 0 };
  for (const s of byStatus) counts[s.status] = s._count._all;
  return { ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0), withoutEmployee: noEmployee, mustChangePassword: mustChange };
}

// ── Mutations ──────────────────────────────────────────────────────────

/** Creates a login-only account (e.g. an auditor) with a temporary password sent by email. */
export async function inviteUser(actor: Actor, input: InviteUserInput) {
  await authorize(actor, "users:manage");
  if (await db.user.findUnique({ where: { email: input.email }, select: { id: true } })) throw new ConflictError("A user with this email already exists");
  const roles = await db.role.findMany({ where: { key: { in: input.roleKeys } }, select: { id: true, key: true } });
  const missing = input.roleKeys.filter((k) => !roles.some((r) => r.key === k));
  if (missing.length) throw new ValidationError(`Unknown role(s): ${missing.join(", ")}`);
  if (roles.some((r) => r.key === "SUPER_ADMIN") && !actor.perms.has("rbac:manage")) throw new ForbiddenError("Granting SUPER_ADMIN requires rbac:manage");
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  const u = await db.user.create({
    data: { email: input.email, name: input.name, passwordHash, status: "INVITED", mustChangePassword: true, roles: { create: roles.map((r) => ({ roleId: r.id })) } },
    select: userSelect,
  });
  await audit(actor, "users.invite", "User", u.id, { after: { email: u.email, name: u.name, roles: roles.map((r) => r.key) } });
  await sendMail({
    to: u.email,
    subject: "You have been invited to HRsoft",
    text: `Hi ${u.name},\n\n${actor.name} invited you to HRsoft.\n\nSign in at ${env().APP_URL}/login with:\n  Email: ${u.email}\n  Temporary password: ${tempPassword}\n\nYou will be asked to set a new password on first sign-in.`,
  });
  return { user: serializeUser(u), tempPassword };
}

export async function suspendUser(actor: Actor, id: string) {
  await authorize(actor, "users:manage");
  if (id === actor.userId) throw new ForbiddenError("You cannot suspend your own account");
  const u = await loadUser(id);
  if (u.status === "SUSPENDED") return serializeUser(u);
  await assertNotLastSuperAdmin(id, "suspend");
  const [updated] = await Promise.all([db.user.update({ where: { id }, data: { status: "SUSPENDED" }, select: userSelect }), revokeAllSessions(id)]);
  await db.apiKey.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(actor, "users.suspend", "User", id, { before: { status: u.status }, after: { status: "SUSPENDED" } });
  return serializeUser(updated);
}

export async function reactivateUser(actor: Actor, id: string) {
  await authorize(actor, "users:manage");
  const u = await loadUser(id);
  if (u.status === "ACTIVE") return serializeUser(u);
  const updated = await db.user.update({ where: { id }, data: { status: "ACTIVE" }, select: userSelect });
  await audit(actor, "users.reactivate", "User", id, { before: { status: u.status }, after: { status: "ACTIVE" } });
  return serializeUser(updated);
}

export async function setUserStatus(actor: Actor, id: string, status: "ACTIVE" | "SUSPENDED") {
  return status === "SUSPENDED" ? suspendUser(actor, id) : reactivateUser(actor, id);
}

/** Issues a new temporary password, forces a change on next login and signs the user out everywhere. */
export async function adminResetPassword(actor: Actor, id: string) {
  await authorize(actor, "users:manage");
  const u = await loadUser(id);
  if (u.status === "SUSPENDED") throw new ConflictError("Reactivate the user before resetting their password");
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  await db.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true } });
  await revokeAllSessions(id);
  await audit(actor, "users.reset_password", "User", id);
  await sendMail({
    to: u.email,
    subject: "Your HRsoft password was reset",
    text: `Hi ${u.name},\n\nAn administrator reset your HRsoft password.\n\nTemporary password: ${tempPassword}\n\nSign in at ${env().APP_URL}/login — you will be asked to choose a new password.`,
  });
  return { userId: id, tempPassword };
}

export async function listSessions(actor: Actor, id: string) {
  await authorize(actor, "users:manage");
  await loadUser(id);
  const rows = await db.session.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, ip: true, userAgent: true, createdAt: true, expiresAt: true } });
  const now = Date.now();
  return rows.map((s) => ({ ...s, createdAt: s.createdAt.toISOString(), expiresAt: s.expiresAt.toISOString(), isExpired: s.expiresAt.getTime() < now }));
}

export async function revokeUserSessions(actor: Actor, id: string) {
  await authorize(actor, "users:manage");
  await loadUser(id);
  const r = await db.session.deleteMany({ where: { userId: id } });
  await audit(actor, "users.revoke_sessions", "User", id, { after: { revoked: r.count } });
  return { revoked: r.count };
}
