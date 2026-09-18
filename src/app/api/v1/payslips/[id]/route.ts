import { ok, route } from "@/lib/api";
import { payslipViewModel } from "@/server/services/payroll";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await payslipViewModel(actor, params.id)));
