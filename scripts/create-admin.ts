/**
 * Create (or promote) a Super Admin user.
 *   npx tsx scripts/create-admin.ts admin@company.com "Full Name" 'StrongPassword123'
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { hash } from "@node-rs/argon2";

const [email, name, password] = process.argv.slice(2);
if (!email || !name || !password) {
  console.error("usage: create-admin.ts <email> <name> <password>");
  process.exit(1);
}
if (password.length < 10) {
  console.error("password must be at least 10 characters");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const role = await db.role.findUnique({ where: { key: "SUPER_ADMIN" } });
  if (!role) throw new Error("SUPER_ADMIN role missing — run `npm run db:seed` (SEED_EMPLOYEES=0) first");
  const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, outputLen: 32, parallelism: 1 });
  const user = await db.user.upsert({
    where: { email: email.toLowerCase() },
    update: { name, passwordHash, status: "ACTIVE", mustChangePassword: false },
    create: { email: email.toLowerCase(), name, passwordHash, status: "ACTIVE", emailVerifiedAt: new Date() },
  });
  await db.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, update: {}, create: { userId: user.id, roleId: role.id } });
  console.log(`Super Admin ready: ${user.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
    await pool.end();
  });
