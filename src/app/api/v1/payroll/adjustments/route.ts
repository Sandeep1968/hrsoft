import { created, ok, parseBody, parseQuery, route } from "@/lib/api";
import { addAdjustment, adjustmentSchema, adjustmentsQuerySchema, listAdjustments } from "@/server/services/payroll";

export const GET = route(async (_req, { actor, query }) => ok(await listAdjustments(actor, parseQuery(query, adjustmentsQuerySchema))));
export const POST = route(async (req, { actor }) => created(await addAdjustment(actor, await parseBody(req, adjustmentSchema))));
