import { created, parseBody, route } from "@/lib/api";
import { addHolidays, holidaysBulkSchema } from "@/server/services/attendance";

export const POST = route<{ id: string }>(async (req, { actor, params }) => created(await addHolidays(actor, params.id, await parseBody(req, holidaysBulkSchema))));
