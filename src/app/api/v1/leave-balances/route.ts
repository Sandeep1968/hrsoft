import { ok, parseBody, parseQuery, route } from "@/lib/api";
import { adjustBalance, adjustBalanceSchema, balancesQuerySchema, getBalances } from "@/server/services/leave";
import { resolveEmployeeId } from "@/server/services/calendar";

export const GET = route(async (_req, { actor, query }) => {
  const q = parseQuery(query, balancesQuerySchema);
  const employeeId = q.employeeId || q.employeeCode ? await resolveEmployeeId(q) : undefined;
  return ok(await getBalances(actor, employeeId, q.year));
});
export const PATCH = route(async (req, { actor }) => ok(await adjustBalance(actor, await parseBody(req, adjustBalanceSchema))));
