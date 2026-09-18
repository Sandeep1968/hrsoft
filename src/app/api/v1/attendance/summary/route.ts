import { z } from "zod";
import { ok, parseQuery, route, zUuid } from "@/lib/api";
import { getMonthlySummary } from "@/server/services/attendance";

/** GET ?employeeId&year&month → payroll contract summary. */
export const GET = route(async (_req, { actor, query }) => {
  const q = parseQuery(query, z.object({ employeeId: zUuid, year: z.coerce.number().int(), month: z.coerce.number().int().min(1).max(12) }));
  return ok(await getMonthlySummary(actor, q.employeeId, q.year, q.month));
});
