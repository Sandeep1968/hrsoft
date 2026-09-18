import { ok, parseBody, route } from "@/lib/api";
import { moveStage, moveStageSchema } from "@/server/services/hiring";

export const POST = route<{ id: string }>(async (req, { actor, params }) => ok(await moveStage(actor, params.id, await parseBody(req, moveStageSchema))));
