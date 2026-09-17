import "server-only";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { env } from "@/lib/env";

/**
 * Prisma 7 client backed by a node-postgres pool.
 *
 * Sizing for 2,000 users: a single Next.js server instance keeps at most
 * DB_POOL_MAX (default 10) connections. On Vercel, point DATABASE_URL at the
 * Neon *pooled* endpoint (PgBouncer, "-pooler" host) and DIRECT_URL at the
 * direct endpoint for migrations. Each serverless instance then holds a
 * small pool and PgBouncer multiplexes onto Postgres.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pgPool?: Pool;
};

function createClient() {
  const pool =
    globalForPrisma.pgPool ??
    new Pool({
      connectionString: env().DATABASE_URL,
      max: env().DB_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  globalForPrisma.pgPool = pool;
  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    log: env().NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const db: PrismaClient = globalForPrisma.prisma ?? createClient();

if (env().NODE_ENV !== "production") globalForPrisma.prisma = db;

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
