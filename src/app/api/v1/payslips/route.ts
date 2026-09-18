import { ok, parseQuery, route } from "@/lib/api";
import { listMyPayslips, payslipsQuerySchema } from "@/server/services/payroll";

/** GET mine, or ?employeeId= for someone in scope */
export const GET = route(async (_req, { actor, query }) => {
  const p = parseQuery(query, payslipsQuerySchema);
  return ok(await listMyPayslips(actor, p.employeeId, { year: p.year }));
});
