import { ok, parseQuery, route } from "@/lib/api";
import { getMonth, monthQuerySchema } from "@/server/services/attendance";

export const GET = route(async (_req, { actor, query }) => {
  const q = parseQuery(query, monthQuerySchema);
  return ok(await getMonth(actor, q.employeeId, q.year, q.month));
});
