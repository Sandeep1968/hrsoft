import { ok, parseBody, route } from "@/lib/api";
import { deleteLeaveType, leaveTypePatchSchema, updateLeaveType } from "@/server/services/leave";

export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateLeaveType(actor, params.id, await parseBody(req, leaveTypePatchSchema))));
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => ok(await deleteLeaveType(actor, params.id)));
