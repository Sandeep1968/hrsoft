import { ok, parseBody, route } from "@/lib/api";
import { assignAsset, assignSchema } from "@/server/services/assets";

export const POST = route<{ id: string }>(async (req, { actor, params }) => ok(await assignAsset(actor, params.id, await parseBody(req, assignSchema))));
