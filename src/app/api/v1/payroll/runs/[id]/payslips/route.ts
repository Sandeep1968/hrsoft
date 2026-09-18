import { ok, paginationSchema, parseQuery, route } from "@/lib/api";
import { listRunPayslips } from "@/server/services/payroll";

export const GET = route<{ id: string }>(async (_req, { actor, params, query }) => ok(await listRunPayslips(actor, params.id, parseQuery(query, paginationSchema))));
