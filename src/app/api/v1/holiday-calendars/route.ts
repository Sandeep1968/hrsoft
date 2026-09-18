import { created, ok, parseBody, route } from "@/lib/api";
import { createHolidayCalendar, holidayCalendarSchema, listHolidayCalendars } from "@/server/services/attendance";

export const GET = route(async (_req, { actor, query }) => {
  const year = query.get("year");
  return ok(await listHolidayCalendars(actor, year ? Number(year) : undefined));
});
export const POST = route(async (req, { actor }) => created(await createHolidayCalendar(actor, await parseBody(req, holidayCalendarSchema))));
