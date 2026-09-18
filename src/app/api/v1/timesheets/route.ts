import { ok, parseQuery, route } from "@/lib/api";
import { listTimesheets, listTimesheetsSchema } from "@/server/services/timesheets";

export const GET = route(async (_req, { actor, query }) => ok(await listTimesheets(actor, parseQuery(query, listTimesheetsSchema))));
