import { ok, parseBody, route } from "@/lib/api";
import { updateKeyResult, updateKeyResultSchema } from "@/server/services/performance";

export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateKeyResult(actor, params.id, await parseBody(req, updateKeyResultSchema))));
