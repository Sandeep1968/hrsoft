import { ok, parseQuery, route } from "@/lib/api";
import { getOrCreateWeek, weekQuerySchema } from "@/server/services/timesheets";

export const GET = route(async (_req, { actor, query }) => {
  const q = parseQuery(query, weekQuerySchema);
  return ok(await getOrCreateWeek(actor, q.employeeId, q.weekStart));
});
