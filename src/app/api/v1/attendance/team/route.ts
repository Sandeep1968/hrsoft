import { ok, parseQuery, route } from "@/lib/api";
import { listTeamAttendance, teamAttendanceQuerySchema } from "@/server/services/attendance";

export const GET = route(async (_req, { actor, query }) => ok(await listTeamAttendance(actor, parseQuery(query, teamAttendanceQuerySchema))));
