import { ok, parseBody, route } from "@/lib/api";
import { deleteShift, shiftPatchSchema, updateShift } from "@/server/services/attendance";

export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateShift(actor, params.id, await parseBody(req, shiftPatchSchema))));
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => ok(await deleteShift(actor, params.id)));
