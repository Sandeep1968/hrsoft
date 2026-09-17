import "server-only";
import { db } from "@/lib/db";
import { RateLimitedError } from "@/lib/errors";

/**
 * Fixed-window rate limiter backed by Postgres so it is consistent across
 * serverless instances. Cheap: one upsert per check.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowSeconds * 1000);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "count", "resetAt") VALUES (${key}, 1, ${resetAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."resetAt" < ${now} THEN 1 ELSE "RateLimit"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimit"."resetAt" < ${now} THEN ${resetAt} ELSE "RateLimit"."resetAt" END
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? 0);
  if (count > limit) throw new RateLimitedError();
}

export async function purgeRateLimits() {
  const r = await db.rateLimit.deleteMany({ where: { resetAt: { lt: new Date() } } });
  return r.count;
}
