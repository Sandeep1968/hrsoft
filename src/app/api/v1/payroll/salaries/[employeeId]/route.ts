import { ok, route } from "@/lib/api";
import { getCurrentSalary } from "@/server/services/payroll";

export const GET = route<{ employeeId: string }>(async (_req, { actor, params }) => ok(await getCurrentSalary(actor, params.employeeId)));
