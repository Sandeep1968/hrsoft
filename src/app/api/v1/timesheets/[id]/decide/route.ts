import { ok, parseBody, route } from "@/lib/api";
import { decideSchema, decideTimesheet } from "@/server/services/timesheets";

/** Shared approval contract: { decision: "APPROVED" | "REJECTED", note? } → updated timesheet. */
export const POST = route<{ id: string }>(async (req, { actor, params }) => ok(await decideTimesheet(actor, params.id, await parseBody(req, decideSchema))));
