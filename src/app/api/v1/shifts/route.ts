import { created, ok, parseBody, route } from "@/lib/api";
import { createShift, listShifts, shiftSchema } from "@/server/services/attendance";

export const GET = route(async (_req, { actor, query }) => ok(await listShifts(actor, { includeInactive: query.get("all") === "1" })));
export const POST = route(async (req, { actor }) => created(await createShift(actor, await parseBody(req, shiftSchema))));
