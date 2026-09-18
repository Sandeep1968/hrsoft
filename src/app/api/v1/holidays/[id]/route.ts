import { ok, route } from "@/lib/api";
import { deleteHoliday } from "@/server/services/attendance";

export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => ok(await deleteHoliday(actor, params.id)));
