import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { randomToken, sha256 } from "@/lib/crypto";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { type Actor, authorize, can } from "@/lib/rbac/authorize";
import { isPermission, type Permission } from "@/lib/rbac/permissions";

export const createApiKeySchema = z.object({
  name: z.string().trim().min(2).max(80),
  scopes: z.array(z.string().trim().min(1).max(60)).min(1).max(100),
  expiresAt: z.coerce.date().optional().nullable(),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

const KEY_PREFIX = "hrs_";

function serialize(k: { id: string; name: string; prefix: string; scopes: string[]; lastUsedAt: Date | null; expiresAt: Date | null; revokedAt: Date | null; createdAt: Date; userId: string; user?: { email: string; name: string } }) {
  const now = Date.now();
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    scopes: k.scopes,
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    expiresAt: k.expiresAt?.toISOString() ?? null,
    revokedAt: k.revokedAt?.toISOString() ?? null,
    createdAt: k.createdAt.toISOString(),
    userId: k.userId,
    owner: k.user ? { email: k.user.email, name: k.user.name } : null,
    state: k.revokedAt ? "REVOKED" : k.expiresAt && k.expiresAt.getTime() < now ? "EXPIRED" : "ACTIVE",
  };
}
export type ApiKeyDto = ReturnType<typeof serialize>;

/** Users holding rbac:manage at ALL scope (i.e. super admins) see every key. */
const seesAllKeys = (actor: Actor) => can(actor, "rbac:manage", "ALL");

/**
 * Creates a key owned by the actor. Scopes are validated against the
 * catalogue and must be a subset of the actor's own permissions (their
 * permissions are the ceiling — see `restrictToScopes`). Raw key is returned once.
 */
export async function createApiKey(actor: Actor, input: CreateApiKeyInput) {
  await authorize(actor, "apikeys:manage");
  if (actor.apiKeyId) throw new ForbiddenError("API keys cannot create other API keys");
  let scopes: string[];
  if (input.scopes.includes("*")) scopes = ["*"];
  else {
    const unknown = input.scopes.filter((s) => !isPermission(s));
    if (unknown.length) throw new ValidationError(`Unknown scope(s): ${unknown.join(", ")}`);
    const notHeld = input.scopes.filter((s) => !actor.perms.has(s as Permission));
    if (notHeld.length) throw new ForbiddenError(`You do not hold: ${notHeld.join(", ")}`);
    scopes = [...new Set(input.scopes)];
  }
  if (input.expiresAt && input.expiresAt.getTime() < Date.now()) throw new ValidationError("Expiry must be in the future");
  const raw = `${KEY_PREFIX}${randomToken(24)}`;
  const k = await db.apiKey.create({ data: { name: input.name, prefix: raw.slice(0, 12), keyHash: sha256(raw), userId: actor.userId, scopes, expiresAt: input.expiresAt ?? null } });
  await audit(actor, "apikeys.create", "ApiKey", k.id, { after: { name: k.name, prefix: k.prefix, scopes, expiresAt: k.expiresAt } });
  return { ...serialize(k), key: raw };
}

export async function listApiKeys(actor: Actor) {
  await authorize(actor, "apikeys:manage");
  const rows = await db.apiKey.findMany({ where: seesAllKeys(actor) ? {} : { userId: actor.userId }, orderBy: { createdAt: "desc" }, include: { user: { select: { email: true, name: true } } } });
  return rows.map(serialize);
}

export async function revokeApiKey(actor: Actor, id: string) {
  await authorize(actor, "apikeys:manage");
  const k = await db.apiKey.findUnique({ where: { id } });
  if (!k) throw new NotFoundError("API key");
  if (k.userId !== actor.userId && !seesAllKeys(actor)) throw new ForbiddenError("You can only revoke your own API keys");
  if (k.revokedAt) return serialize(k);
  const updated = await db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit(actor, "apikeys.revoke", "ApiKey", id, { before: { name: k.name, prefix: k.prefix } });
  return serialize(updated);
}
