/** Shared helpers for service tests (not shipped; imported by *.test.ts only). */
import { db } from "@/lib/db";
import { type Actor, loadActor } from "@/lib/rbac/authorize";

export async function actorFor(email: string): Promise<Actor> {
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`Seed user ${email} not found — run npm run db:seed`);
  const actor = await loadActor(user.id);
  if (!actor) throw new Error(`Could not load actor for ${email}`);
  return actor;
}

export function rand(prefix = "T") {
  return `${prefix}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}
