import { created, ok, parseBody, route } from "@/lib/api";
import { createOffer, getOffer, offerSchema } from "@/server/services/hiring";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await getOffer(actor, params.id)));
export const POST = route<{ id: string }>(async (req, { actor, params }) => created(await createOffer(actor, params.id, await parseBody(req, offerSchema))));
