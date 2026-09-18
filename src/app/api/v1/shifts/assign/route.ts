import { ok, parseBody, route } from "@/lib/api";
import { assignShift, assignShiftSchema } from "@/server/services/attendance";

export const POST = route(async (req, { actor }) => ok(await assignShift(actor, await parseBody(req, assignShiftSchema))));
