import { ok, parseBody, route } from "@/lib/api";
import { decideRemoteWork, decideSchema } from "@/server/services/attendance";

export const POST = route<{ id: string }>(async (req, { actor, params }) => {
  const body = await parseBody(req, decideSchema);
  return ok(await decideRemoteWork(actor, params.id, body.decision, body.note));
});
