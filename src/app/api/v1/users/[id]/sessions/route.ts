import { ok, route } from "@/lib/api";
import { listSessions, revokeUserSessions } from "@/server/services/users";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await listSessions(actor, params.id)));
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => ok(await revokeUserSessions(actor, params.id)));
