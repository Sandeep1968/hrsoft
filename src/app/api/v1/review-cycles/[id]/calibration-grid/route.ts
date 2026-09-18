import { ok, route } from "@/lib/api";
import { calibrationGrid } from "@/server/services/performance";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await calibrationGrid(actor, params.id)));
