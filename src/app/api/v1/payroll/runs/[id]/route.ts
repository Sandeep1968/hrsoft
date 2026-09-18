import { ok, route } from "@/lib/api";
import { deleteRun, getRun, reopenRun } from "@/server/services/payroll";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await getRun(actor, params.id)));
/** REVIEW → DRAFT (payslips deleted). A DRAFT run is deleted outright. */
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => {
  const run = await getRun(actor, params.id);
  if (run.status === "DRAFT") return ok(await deleteRun(actor, params.id));
  return ok(await reopenRun(actor, params.id));
});
