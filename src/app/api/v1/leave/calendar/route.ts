import { ok, parseQuery, route } from "@/lib/api";
import { calendarQuerySchema, teamLeaveCalendar } from "@/server/services/leave";

export const GET = route(async (_req, { actor, query }) => ok(await teamLeaveCalendar(actor, parseQuery(query, calendarQuerySchema))));
