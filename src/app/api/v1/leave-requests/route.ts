import { created, ok, parseBody, parseQuery, route } from "@/lib/api";
import { applyLeave, applyLeaveSchema, leaveListSchema, listLeaveRequests } from "@/server/services/leave";

export const GET = route(async (_req, { actor, query }) => ok(await listLeaveRequests(actor, parseQuery(query, leaveListSchema))));
export const POST = route(async (req, { actor }) => created(await applyLeave(actor, await parseBody(req, applyLeaveSchema))));
