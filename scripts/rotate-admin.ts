/**
 * Rename a user and/or rotate their password, revoking all sessions.
 *   npx tsx scripts/rotate-admin.ts <current-email> <new-email> <new-password>
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { hash } from "@node-rs/argon2";

const [oldEmail, newEmail, password] = process.argv.slice(2);
if (!oldEmail || !newEmail || !password || password.length < 10) {
  console.error("usage: rotate-admin.ts <current-email> <new-email> <new-password(10+ chars)>");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, outputLen: 32, parallelism: 1 });
  const u = await db.user.update({
    where: { email: oldEmail.toLowerCase() },
    data: { email: newEmail.toLowerCase(), passwordHash, mustChangePassword: false, status: "ACTIVE" },
  });
  await db.session.deleteMany({ where: { userId: u.id } });
  await db.rateLimit.deleteMany({ where: { key: { in: [`login:${oldEmail.toLowerCase()}`, `login:${newEmail.toLowerCase()}`] } } });
  console.log(`updated ${oldEmail} → ${u.email}; sessions revoked`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
    await pool.end();
  });
