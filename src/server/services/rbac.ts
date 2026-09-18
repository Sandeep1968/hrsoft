import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { paginate, toPage, type Pagination } from "@/lib/api";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { type Actor, authorize } from "@/lib/rbac/authorize";
import { ALL_PERMISSIONS, PERMISSIONS, SYSTEM_ROLE_KEYS, isPermission, moduleOf, type Permission, type Scope } from "@/lib/rbac/permissions";

// ── Schemas ────────────────────────────────────────────────────────────

export const grantSchema = z.object({
  permission: z.string().refine(isPermission, "Unknown permission"),
  scope: z.enum(["SELF", "TEAM", "ALL"]),
});
export type GrantInput = z.infer<typeof grantSchema>;

export const createRoleSchema = z.object({
  key: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase().replace(/[\s-]+/g, "_"))
    .pipe(z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, "Key must be UPPER_SNAKE_CASE (2–40 chars)")),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional().nullable(),
  grants: z.array(grantSchema).max(ALL_PERMISSIONS.length).default([]),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  grants: z.array(grantSchema).max(ALL_PERMISSIONS.length).optional(),
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const assignRolesSchema = z.object({ roleKeys: z.array(z.string().trim().min(1).max(40)).max(20) });

const MODULE_LABELS: Record<string, string> = {
  org: "Organisation",
  employees: "Employees",
  onboarding: "Onboarding",
  documents: "Documents",
  exits: "Exits",
  attendance: "Attendance",
  leave: "Leave",
  payroll: "Payroll",
  tax: "Tax",
  expenses: "Expenses",
  assets: "Assets",
  helpdesk: "Helpdesk",
  performance: "Performance",
  hiring: "Hiring",
  engagement: "Engagement",
  projects: "Projects",
  timesheets: "Timesheets",
  reports: "Reports",
  settings: "Settings",
  rbac: "Roles & access",
  users: "Users",
  audit: "Audit",
  apikeys: "API keys",
};

export const MODULE_ORDER = [...new Set(ALL_PERMISSIONS.map(moduleOf))];
export function moduleLabel(m: string) {
  return MODULE_LABELS[m] ?? m;
}

/** PERMISSIONS grouped by module (serialisable; used by the UI). */
export function permissionGroups() {
  return MODULE_ORDER.map((module) => ({
    module,
    label: moduleLabel(module),
    permissions: ALL_PERMISSIONS.filter((p) => moduleOf(p) === module).map((p) => ({ permission: p, description: PERMISSIONS[p] })),
  }));
}

function dedupeGrants(grants: GrantInput[]): { permission: Permission; scope: Scope }[] {
  const map = new Map<Permission, Scope>();
  for (const g of grants) map.set(g.permission as Permission, g.scope);
  return [...map].map(([permission, scope]) => ({ permission, scope }));
}

// ── Roles ──────────────────────────────────────────────────────────────

export async function listRoles(actor: Actor) {
  await authorize(actor, "rbac:manage");
  const rows = await db.role.findMany({ orderBy: [{ isSystem: "desc" }, { name: "asc" }], include: { _count: { select: { permissions: true, users: true } } } });
  return rows.map((r) => ({ id: r.id, key: r.key, name: r.name, description: r.description, isSystem: r.isSystem, permissionCount: r._count.permissions, userCount: r._count.users, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }));
}

/** Lightweight list for pickers (any actor who manages users or roles). */
export async function roleOptions(actor: Actor) {
  if (!actor.perms.has("rbac:manage") && !actor.perms.has("users:manage")) throw new ForbiddenError("Missing permission users:manage");
  const rows = await db.role.findMany({ orderBy: [{ isSystem: "desc" }, { name: "asc" }], select: { id: true, key: true, name: true, isSystem: true } });
  return rows;
}

export async function getRole(actor: Actor, id: string) {
  await authorize(actor, "rbac:manage");
  const r = await db.role.findUnique({ where: { id }, include: { permissions: true, _count: { select: { users: true } } } });
  if (!r) throw new NotFoundError("Role");
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    isImmutable: r.key === "SUPER_ADMIN",
    userCount: r._count.users,
    grants: r.permissions.filter((p) => isPermission(p.permission)).map((p) => ({ permission: p.permission as Permission, scope: p.scope as Scope })),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
export type RoleDetail = Awaited<ReturnType<typeof getRole>>;

export async function createRole(actor: Actor, input: CreateRoleInput) {
  await authorize(actor, "rbac:manage");
  if (SYSTEM_ROLE_KEYS.includes(input.key)) throw new ConflictError(`${input.key} is a reserved system role key`);
  if (await db.role.findUnique({ where: { key: input.key }, select: { id: true } })) throw new ConflictError(`Role ${input.key} already exists`);
  const grants = dedupeGrants(input.grants);
  const r = await db.role.create({ data: { key: input.key, name: input.name, description: input.description ?? null, isSystem: false, permissions: { create: grants } } });
  await audit(actor, "rbac.role_create", "Role", r.id, { after: { key: r.key, name: r.name, grants } });
  return getRole(actor, r.id);
}

export async function updateRole(actor: Actor, id: string, input: UpdateRoleInput) {
  await authorize(actor, "rbac:manage");
  const before = await db.role.findUnique({ where: { id }, include: { permissions: true } });
  if (!before) throw new NotFoundError("Role");
  if (input.grants && before.key === "SUPER_ADMIN") throw new ForbiddenError("SUPER_ADMIN permissions are immutable");
  const grants = input.grants ? dedupeGrants(input.grants) : null;
  if (grants && before.key === "EMPLOYEE" && grants.length === 0) throw new ValidationError("The EMPLOYEE role must keep at least one permission");
  await db.$transaction(async (tx) => {
    await tx.role.update({ where: { id }, data: { name: input.name, description: input.description === undefined ? undefined : input.description } });
    if (grants) {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      if (grants.length) await tx.rolePermission.createMany({ data: grants.map((g) => ({ roleId: id, ...g })) });
    }
  });
  await audit(actor, "rbac.role_update", "Role", id, {
    before: { name: before.name, description: before.description, grants: before.permissions.map((p) => ({ permission: p.permission, scope: p.scope })) },
    after: { name: input.name ?? before.name, description: input.description === undefined ? before.description : input.description, grants: grants ?? undefined },
  });
  return getRole(actor, id);
}

export async function deleteRole(actor: Actor, id: string) {
  await authorize(actor, "rbac:manage");
  const r = await db.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
  if (!r) throw new NotFoundError("Role");
  if (r.isSystem) throw new ForbiddenError("System roles cannot be deleted");
  if (r._count.users > 0) throw new ConflictError(`Role is assigned to ${r._count.users} user(s); remove it from them first`);
  await db.role.delete({ where: { id } });
  await audit(actor, "rbac.role_delete", "Role", id, { before: { key: r.key, name: r.name } });
  return { id };
}

// ── Assignments ────────────────────────────────────────────────────────

/** Replaces the user's role set. Guards: cannot drop your own SUPER_ADMIN; cannot orphan the last SUPER_ADMIN. */
export async function assignRoles(actor: Actor, userId: string, roleKeys: string[]) {
  await authorize(actor, "rbac:manage");
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, roles: { select: { role: { select: { id: true, key: true } } } } } });
  if (!user) throw new NotFoundError("User");
  const wanted = [...new Set(roleKeys)];
  const roles = wanted.length ? await db.role.findMany({ where: { key: { in: wanted } }, select: { id: true, key: true } }) : [];
  const missing = wanted.filter((k) => !roles.some((r) => r.key === k));
  if (missing.length) throw new ValidationError(`Unknown role(s): ${missing.join(", ")}`);
  const beforeKeys = user.roles.map((r) => r.role.key).sort();
  const afterKeys = roles.map((r) => r.key).sort();
  const hadSuper = beforeKeys.includes("SUPER_ADMIN");
  const keepsSuper = afterKeys.includes("SUPER_ADMIN");
  if (userId === actor.userId && hadSuper && !keepsSuper) throw new ForbiddenError("You cannot remove your own SUPER_ADMIN role");
  if (hadSuper && !keepsSuper) {
    const others = await db.userRole.count({ where: { role: { key: "SUPER_ADMIN" }, userId: { not: userId }, user: { status: "ACTIVE" } } });
    if (others === 0) throw new ConflictError("Cannot remove the last active SUPER_ADMIN");
  }
  await db.$transaction(async (tx) => {
    await tx.userRole.deleteMany({ where: { userId } });
    if (roles.length) await tx.userRole.createMany({ data: roles.map((r) => ({ userId, roleId: r.id })) });
  });
  await audit(actor, "rbac.assign_roles", "User", userId, { before: { roles: beforeKeys }, after: { roles: afterKeys } });
  return { userId, roles: afterKeys };
}

// ── Matrix ─────────────────────────────────────────────────────────────

export async function permissionMatrix(actor: Actor) {
  await authorize(actor, "rbac:manage");
  const roles = await db.role.findMany({ orderBy: [{ isSystem: "desc" }, { name: "asc" }], select: { id: true, key: true, name: true, isSystem: true, permissions: { select: { permission: true, scope: true } } } });
  const byRole = new Map(roles.map((r) => [r.key, new Map(r.permissions.map((p) => [p.permission, p.scope as Scope]))]));
  return {
    roles: roles.map((r) => ({ id: r.id, key: r.key, name: r.name, isSystem: r.isSystem })),
    modules: permissionGroups().map((g) => ({
      ...g,
      permissions: g.permissions.map((p) => ({ ...p, scopes: Object.fromEntries(roles.map((r) => [r.key, byRole.get(r.key)?.get(p.permission) ?? null])) as Record<string, Scope | null> })),
    })),
  };
}

export async function usersWithRole(actor: Actor, roleId: string, p: Pick<Pagination, "page" | "pageSize">) {
  await authorize(actor, "rbac:manage");
  const role = await db.role.findUnique({ where: { id: roleId }, select: { id: true } });
  if (!role) throw new NotFoundError("Role");
  const where = { roleId };
  const [rows, total] = await Promise.all([
    db.userRole.findMany({ where, orderBy: { assignedAt: "desc" }, ...paginate(p), select: { assignedAt: true, user: { select: { id: true, email: true, name: true, status: true, lastLoginAt: true, employee: { select: { employeeCode: true, displayName: true } } } } } }),
    db.userRole.count({ where }),
  ]);
  return toPage(rows.map((r) => ({ userId: r.user.id, email: r.user.email, name: r.user.name, status: r.user.status, lastLoginAt: r.user.lastLoginAt?.toISOString() ?? null, employeeCode: r.user.employee?.employeeCode ?? null, assignedAt: r.assignedAt.toISOString() })), total, p);
}
