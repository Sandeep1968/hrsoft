import { ok, route } from "@/lib/api";
import { revokeApiKey } from "@/server/services/apikeys";

export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => ok(await revokeApiKey(actor, params.id)));
