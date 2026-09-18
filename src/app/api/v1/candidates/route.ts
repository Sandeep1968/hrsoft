import { created, ok, paginationSchema, parseBody, parseQuery, route } from "@/lib/api";
import { candidateSchema, createCandidate, listCandidates } from "@/server/services/hiring";

export const GET = route(async (_req, { actor, query }) => ok(await listCandidates(actor, parseQuery(query, paginationSchema))));
export const POST = route(async (req, { actor }) => created(await createCandidate(actor, await parseBody(req, candidateSchema))));
