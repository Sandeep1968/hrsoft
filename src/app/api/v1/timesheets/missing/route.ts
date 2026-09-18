import { z } from "zod";
import { ok, parseQuery, route, zDateOnly } from "@/lib/api";
import { missingTimesheets } from "@/server/services/timesheets";

export const GET = route(async (_req, { actor, query }) => ok(await missingTimesheets(actor, parseQuery(query, z.object({ weekStart: zDateOnly.optional() })).weekStart)));
