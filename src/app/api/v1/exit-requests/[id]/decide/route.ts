import { ok, parseBody, route } from "@/lib/api";
import { decideExit, decideExitSchema } from "@/server/services/exits";

/** Approval contract: { decision: "APPROVED" | "REJECTED", note? } → updated exit request. */
export const POST = route<{ id: string }>(async (req, { actor, params }) => {
  const body = await parseBody(req, decideExitSchema);
  return ok(await decideExit(actor, params.id, body.decision, body.note));
});
