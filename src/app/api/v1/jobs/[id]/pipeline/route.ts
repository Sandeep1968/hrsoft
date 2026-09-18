import { ok, route } from "@/lib/api";
import { pipeline } from "@/server/services/hiring";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await pipeline(actor, params.id)));
