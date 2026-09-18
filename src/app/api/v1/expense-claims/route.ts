import { created, ok, parseBody, parseQuery, route } from "@/lib/api";
import { claimsQuerySchema, createClaim, createClaimSchema, listClaims } from "@/server/services/expenses";

export const GET = route(async (_req, { actor, query }) => ok(await listClaims(actor, parseQuery(query, claimsQuerySchema))));
export const POST = route(async (req, { actor }) => created(await createClaim(actor, await parseBody(req, createClaimSchema))));
