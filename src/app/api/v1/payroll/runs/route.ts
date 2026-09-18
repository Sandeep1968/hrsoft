import { created, ok, parseBody, parseQuery, route } from "@/lib/api";
import { createRun, createRunSchema, listRuns, runsQuerySchema } from "@/server/services/payroll";

export const GET = route(async (_req, { actor, query }) => ok(await listRuns(actor, parseQuery(query, runsQuerySchema))));
export const POST = route(async (req, { actor }) => created(await createRun(actor, await parseBody(req, createRunSchema))));
