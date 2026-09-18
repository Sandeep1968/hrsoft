import { created, ok, parseBody, parseQuery, route } from "@/lib/api";
import { listRegularizations, regularizationSchema, requestListSchema, requestRegularization } from "@/server/services/attendance";

export const GET = route(async (_req, { actor, query }) => ok(await listRegularizations(actor, parseQuery(query, requestListSchema))));
export const POST = route(async (req, { actor }) => created(await requestRegularization(actor, await parseBody(req, regularizationSchema))));
