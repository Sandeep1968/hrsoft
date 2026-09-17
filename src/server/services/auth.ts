import "server-only";
import { db } from "@/lib/db";
import { hashPassword, passwordPolicyIssue, verifyPassword } from "@/lib/auth/password";
import { createSession, revokeAllSessions } from "@/lib/auth/session";
import { randomToken, sha256 } from "@/lib/crypto";
import { AppError, ForbiddenError, UnauthorizedError, ValidationError } from "@/lib/errors";
import { rateLimit } from "@/lib/ratelimit";
import { sendMail } from "@/lib/mail";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import type { GoogleProfile } from "@/lib/auth/google";
import type { Actor } from "@/lib/rbac/authorize";

interface Meta {
  ip?: string | null;
  userAgent?: string | null;
}

export async function loginWithPassword(email: string, password: string, meta: Meta) {
  const normalized = email.trim().toLowerCase();
  await rateLimit(`login:${normalized}`, 8, 15 * 60);
  if (meta.ip) await rateLimit(`login-ip:${meta.ip}`, 40, 15 * 60);

  const user = await db.user.findUnique({ where: { email: normalized }, select: { id: true, passwordHash: true, status: true } });
  // Constant-ish time: always verify against a hash even when the user is missing.
  const ok = user?.passwordHash ? await verifyPassword(user.passwordHash, password) : await verifyPassword(DUMMY_HASH, password);
  if (!user || !ok) {
    await audit(null, "auth.login_failed", "User", user?.id ?? null, { after: { email: normalized } });
    throw new UnauthorizedError("Invalid email or password");
  }
  if (user.status === "SUSPENDED") throw new ForbiddenError("This account is suspended");
  const session = await createSession(user.id, meta);
  await audit({ userId: user.id, ip: meta.ip ?? undefined } as Actor, "auth.login", "User", user.id);
  return session;
}

// Pre-computed argon2 hash of a random string, used to equalise timing for unknown users.
const DUMMY_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Q2y3T2fJ9WlyYb0p1p7z0m8qYb2Q0pGz1o0m4h4x2rQ";

/** Google SSO: link to an existing user by verified email; never auto-creates accounts. */
export async function loginWithGoogle(profile: GoogleProfile, meta: Meta) {
  if (!profile.emailVerified) throw new UnauthorizedError("Google account email is not verified");
  const allowed = env().GOOGLE_ALLOWED_DOMAIN;
  if (allowed && profile.hd !== allowed && !profile.email.endsWith(`@${allowed}`)) {
    throw new ForbiddenError(`Sign in with your ${allowed} Google Workspace account`);
  }
  const linked = await db.oAuthAccount.findUnique({
    where: { provider_providerAccountId: { provider: "google", providerAccountId: profile.sub } },
    select: { user: { select: { id: true, status: true } } },
  });
  let user = linked?.user ?? null;
  if (!user) {
    const byEmail = await db.user.findUnique({ where: { email: profile.email }, select: { id: true, status: true } });
    if (!byEmail) throw new ForbiddenError("No HRsoft account exists for this Google email. Ask HR to invite you.");
    await db.oAuthAccount.create({ data: { provider: "google", providerAccountId: profile.sub, userId: byEmail.id } });
    user = byEmail;
  }
  if (user.status === "SUSPENDED") throw new ForbiddenError("This account is suspended");
  await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date(), image: profile.picture ?? undefined, status: "ACTIVE" } });
  const session = await createSession(user.id, meta);
  await audit({ userId: user.id, ip: meta.ip ?? undefined } as Actor, "auth.login_google", "User", user.id);
  return session;
}

export async function requestPasswordReset(email: string, meta: Meta) {
  const normalized = email.trim().toLowerCase();
  await rateLimit(`reset:${normalized}`, 3, 60 * 60);
  const user = await db.user.findUnique({ where: { email: normalized }, select: { id: true, name: true } });
  if (!user) return; // do not reveal existence
  const token = randomToken(32);
  await db.passwordResetToken.create({ data: { tokenHash: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + 60 * 60 * 1000) } });
  const link = `${env().APP_URL}/reset-password?token=${token}`;
  await sendMail({ to: normalized, subject: "Reset your HRsoft password", text: `Hi ${user.name},\n\nReset your password using this link (valid for 1 hour):\n${link}\n\nIf you did not request this, ignore this email.` });
  await audit({ userId: user.id, ip: meta.ip ?? undefined } as Actor, "auth.reset_requested", "User", user.id);
}

export async function resetPassword(token: string, password: string) {
  const issue = passwordPolicyIssue(password);
  if (issue) throw new ValidationError(issue);
  const rec = await db.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!rec || rec.usedAt || rec.expiresAt.getTime() < Date.now()) throw new AppError("INVALID_TOKEN", "This reset link is invalid or has expired", 400);
  await db.$transaction([
    db.user.update({ where: { id: rec.userId }, data: { passwordHash: await hashPassword(password), mustChangePassword: false, status: "ACTIVE" } }),
    db.passwordResetToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
  ]);
  await revokeAllSessions(rec.userId);
  await audit({ userId: rec.userId } as Actor, "auth.password_reset", "User", rec.userId);
}

export async function changePassword(actor: Actor, current: string, next: string) {
  const issue = passwordPolicyIssue(next);
  if (issue) throw new ValidationError(issue);
  const user = await db.user.findUnique({ where: { id: actor.userId }, select: { passwordHash: true } });
  if (user?.passwordHash && !(await verifyPassword(user.passwordHash, current))) throw new UnauthorizedError("Current password is incorrect");
  await db.user.update({ where: { id: actor.userId }, data: { passwordHash: await hashPassword(next), mustChangePassword: false } });
  await audit(actor, "auth.password_changed", "User", actor.userId);
}
