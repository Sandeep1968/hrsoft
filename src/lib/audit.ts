import "server-only";
import { db, type Tx } from "@/lib/db";
import type { Actor } from "@/lib/rbac/authorize";
import type { Prisma } from "@/generated/prisma/client";

type Json = Prisma.InputJsonValue;

/** Append an audit entry. Never throws — auditing must not break the primary action. */
export async function audit(
  actor: Actor | null,
  action: string,
  entityType: string,
  entityId?: string | null,
  changes: { before?: unknown; after?: unknown } = {},
  tx?: Tx,
) {
  try {
    const client = tx ?? db;
    await client.auditLog.create({
      data: {
        actorId: actor && actor.roles[0] !== "SYSTEM" ? actor.userId : null,
        action,
        entityType,
        entityId: entityId ?? null,
        before: changes.before === undefined ? undefined : (sanitize(changes.before) as Json),
        after: changes.after === undefined ? undefined : (sanitize(changes.after) as Json),
        ip: actor?.ip ?? null,
      },
    });
  } catch (e) {
    console.error("audit failed", e);
  }
}

const REDACT = /pass|secret|token|hash|aadhaar|pan(Enc)?$|accountNumber/i;

function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(sanitize);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT.test(k) ? "[redacted]" : sanitize(v);
    }
    return out;
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}
