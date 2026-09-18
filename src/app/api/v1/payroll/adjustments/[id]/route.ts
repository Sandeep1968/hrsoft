import { ok, route } from "@/lib/api";
import { deleteAdjustment } from "@/server/services/payroll";

export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => ok(await deleteAdjustment(actor, params.id)));
