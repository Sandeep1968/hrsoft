import { ok, parseBody, route } from "@/lib/api";
import { returnAsset, returnSchema } from "@/server/services/assets";

export const POST = route<{ id: string }>(async (req, { actor, params }) => ok(await returnAsset(actor, params.id, await parseBody(req, returnSchema))));
