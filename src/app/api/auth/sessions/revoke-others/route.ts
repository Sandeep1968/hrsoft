import { cookies } from "next/headers";
import { ok, route } from "@/lib/api";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

/** Signs the actor out everywhere except the current browser session. */
export const POST = route(async (_req, { actor }) => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const current = token ? sha256(token) : null;
  const r = await db.session.deleteMany({ where: { userId: actor.userId, ...(current ? { tokenHash: { not: current } } : {}) } });
  await audit(actor, "auth.sessions_revoked_others", "User", actor.userId, { after: { revoked: r.count } });
  return ok({ revoked: r.count });
});
