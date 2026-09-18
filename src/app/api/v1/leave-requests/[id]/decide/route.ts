import { ok, parseBody, route } from "@/lib/api";
import { decideLeave, decideSchema } from "@/server/services/leave";

export const POST = route<{ id: string }>(async (req, { actor, params }) => {
  const body = await parseBody(req, decideSchema);
  return ok(await decideLeave(actor, params.id, body.decision, body.note));
});
