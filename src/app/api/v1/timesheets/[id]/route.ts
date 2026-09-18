import { ok, parseBody, route } from "@/lib/api";
import { getTimesheet, saveEntries, saveEntriesSchema } from "@/server/services/timesheets";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await getTimesheet(actor, params.id)));
export const PUT = route<{ id: string }>(async (req, { actor, params }) => ok(await saveEntries(actor, params.id, (await parseBody(req, saveEntriesSchema)).entries)));
