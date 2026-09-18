import { ok, route } from "@/lib/api";
import { moveToCalibration } from "@/server/services/performance";

export const POST = route<{ id: string }>(async (_req, { actor, params }) => ok(await moveToCalibration(actor, params.id)));
