import { ok, parseBody, route } from "@/lib/api";
import { calibrate, calibrateSchema } from "@/server/services/performance";

export const POST = route<{ id: string }>(async (req, { actor, params }) => ok(await calibrate(actor, params.id, (await parseBody(req, calibrateSchema)).finalRating)));
