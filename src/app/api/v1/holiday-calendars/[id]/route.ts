import { ok, parseBody, route } from "@/lib/api";
import { deleteHolidayCalendar, holidayCalendarPatchSchema, updateHolidayCalendar } from "@/server/services/attendance";

export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateHolidayCalendar(actor, params.id, await parseBody(req, holidayCalendarPatchSchema))));
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => ok(await deleteHolidayCalendar(actor, params.id)));
