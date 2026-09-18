import { created, parseBody, route } from "@/lib/api";
import { cloneCalendarSchema, cloneHolidayCalendar } from "@/server/services/attendance";

export const POST = route<{ id: string }>(async (req, { actor, params }) => {
  const body = await parseBody(req, cloneCalendarSchema);
  return created(await cloneHolidayCalendar(actor, params.id, body.targetYear));
});
