import { created, ok, parseBody, route } from "@/lib/api";
import { createLeaveType, leaveTypeSchema, listLeaveTypes } from "@/server/services/leave";

export const GET = route(async (_req, { actor, query }) => ok(await listLeaveTypes(actor, { includeInactive: query.get("all") === "1" })));
export const POST = route(async (req, { actor }) => created(await createLeaveType(actor, await parseBody(req, leaveTypeSchema))));
