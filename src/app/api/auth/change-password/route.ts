import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { changePassword } from "@/server/services/auth";

export const POST = route(async (req, { actor }) => {
  const body = await parseBody(req, z.object({ currentPassword: z.string().max(128), newPassword: z.string().min(1).max(128) }));
  await changePassword(actor, body.currentPassword, body.newPassword);
  return ok({ ok: true });
});
