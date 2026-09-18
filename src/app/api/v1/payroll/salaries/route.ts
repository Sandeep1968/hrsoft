import { created, ok, parseBody, parseQuery, route } from "@/lib/api";
import { assignSalary, assignSalarySchema, listSalaries, salariesQuerySchema } from "@/server/services/payroll";

export const GET = route(async (_req, { actor, query }) => ok(await listSalaries(actor, parseQuery(query, salariesQuerySchema))));
export const POST = route(async (req, { actor }) => created(await assignSalary(actor, await parseBody(req, assignSalarySchema))));
