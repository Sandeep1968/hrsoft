import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { cancelExit, clearanceSchema, getExit, updateClearance } from "@/server/services/exits";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await getExit(actor, params.id)));

/** PATCH { clearance: {...} } updates the clearance checklist; PATCH { status: "CANCELLED" } withdraws a pending request. */
export const PATCH = route<{ id: string }>(async (req, { actor, params }) => {
  const body = await parseBody(req, z.object({ status: z.literal("CANCELLED").optional(), clearance: clearanceSchema.optional() }));
  if (body.status === "CANCELLED") return ok(await cancelExit(actor, params.id));
  return ok(await updateClearance(actor, params.id, body.clearance ?? {}));
});
