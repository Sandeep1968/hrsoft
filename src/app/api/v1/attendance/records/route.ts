import { z } from "zod";
import { ok, parseBody, parseQuery, route, zDateOnly, zUuid } from "@/lib/api";
import { adminRecordSchema, adminUpsertRecord, getRecord } from "@/server/services/attendance";
import { resolveEmployeeId } from "@/server/services/calendar";

/** GET ?employeeId|employeeCode&date → single record with punches (null if none) plus the employee. */
export const GET = route(async (_req, { actor, query }) => {
  const q = parseQuery(query, z.object({ employeeId: zUuid.optional(), employeeCode: z.string().trim().max(120).optional(), date: zDateOnly }));
  const employeeId = await resolveEmployeeId(q);
  return ok(await getRecord(actor, employeeId, q.date));
});

/** PATCH → admin upsert / correction. */
export const PATCH = route(async (req, { actor }) => ok(await adminUpsertRecord(actor, await parseBody(req, adminRecordSchema))));
