import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { db } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";
import { isProd } from "@/lib/env";
import { type Actor, loadActor, restrictToScopes } from "@/lib/rbac/authorize";

export const SESSION_COOKIE = "hrsoft_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
const SESSION_RENEW_MS = 1000 * 60 * 60 * 24 * 7; // renew when < 7 days left

export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null } = {}) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({
    data: { tokenHash: sha256(token), userId, expiresAt, ip: meta.ip ?? undefined, userAgent: meta.userAgent?.slice(0, 255) },
  });
  await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd(),
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: isProd(), path: "/", maxAge: 0 });
}

export async function revokeCurrentSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  await clearSessionCookie();
}

export async function revokeAllSessions(userId: string) {
  await db.session.deleteMany({ where: { userId } });
}

/** Validate a raw session token → userId (renews sliding expiry). */
export async function validateSessionToken(token: string): Promise<{ userId: string; sessionId: string } | null> {
  const session = await db.session.findUnique({ where: { tokenHash: sha256(token) }, select: { id: true, userId: true, expiresAt: true } });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (session.expiresAt.getTime() - Date.now() < SESSION_RENEW_MS) {
    await db.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) } }).catch(() => {});
  }
  return { userId: session.userId, sessionId: session.id };
}

async function actorFromApiKey(raw: string): Promise<Actor | null> {
  const key = await db.apiKey.findUnique({ where: { keyHash: sha256(raw) }, select: { id: true, userId: true, scopes: true, expiresAt: true, revokedAt: true } });
  if (!key || key.revokedAt) return null;
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return null;
  const actor = await loadActor(key.userId);
  if (!actor) return null;
  db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { ...restrictToScopes(actor, key.scopes), apiKeyId: key.id };
}

/**
 * Current actor for the request: session cookie first, then `Authorization: Bearer hrs_...` API key.
 * Cached per request via React `cache`.
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? hdrs.get("x-real-ip") ?? undefined;
  if (token) {
    const s = await validateSessionToken(token);
    if (s) {
      const actor = await loadActor(s.userId);
      if (actor) return { ...actor, ip };
    }
  }
  const auth = hdrs.get("authorization");
  if (auth?.startsWith("Bearer hrs_")) {
    const actor = await actorFromApiKey(auth.slice("Bearer ".length));
    if (actor) return { ...actor, ip };
  }
  return null;
});

/** Housekeeping: drop expired sessions (called from the daily cron). */
export async function purgeExpiredSessions() {
  const r = await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return r.count;
}
