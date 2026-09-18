import { ok, route } from "@/lib/api";
import { searchEmployeesForPayroll } from "@/server/services/payroll";

/** GET ?q= — employee picker for salary setup / adjustments */
export const GET = route(async (_req, { actor, query }) => ok(await searchEmployeesForPayroll(actor, query.get("q") ?? "")));
