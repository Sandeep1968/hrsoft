import { z } from "zod";
import { ok, parseQuery, route, zDateOnly } from "@/lib/api";
import { weeklySummary } from "@/server/services/timesheets";

export const GET = route(async (_req, { actor, query }) => ok(await weeklySummary(actor, parseQuery(query, z.object({ weekStart: zDateOnly.optional() })).weekStart)));
