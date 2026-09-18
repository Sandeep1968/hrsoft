import { ok, route } from "@/lib/api";
import { finalizeRun } from "@/server/services/payroll";

export const POST = route<{ id: string }>(async (_req, { actor, params }) => ok(await finalizeRun(actor, params.id)));
