import { ok, route } from "@/lib/api";
import { cancelLeave, getLeaveRequest } from "@/server/services/leave";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await getLeaveRequest(actor, params.id)));
/** DELETE = cancel (own pending, or approved and not yet started). */
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => ok(await cancelLeave(actor, params.id)));
