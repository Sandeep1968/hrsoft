import { created, ok, parseBody, parseQuery, route } from "@/lib/api";
import { givePraise, givePraiseSchema, listPraise, listPraiseSchema } from "@/server/services/performance";

export const GET = route(async (_req, { actor, query }) => ok(await listPraise(actor, parseQuery(query, listPraiseSchema))));
export const POST = route(async (req, { actor }) => created(await givePraise(actor, await parseBody(req, givePraiseSchema))));
