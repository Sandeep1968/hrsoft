import { ok, parseBody, route } from "@/lib/api";
import { respondOffer, respondOfferSchema } from "@/server/services/hiring";

export const POST = route<{ id: string }>(async (req, { actor, params }) => ok(await respondOffer(actor, params.id, (await parseBody(req, respondOfferSchema)).response)));
