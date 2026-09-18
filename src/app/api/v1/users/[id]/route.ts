import { ok, parseBody, route } from "@/lib/api";
import { getUser, setUserStatus, userStatusSchema } from "@/server/services/users";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await getUser(actor, params.id)));
/** PATCH { status: "ACTIVE" | "SUSPENDED" } */
export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await setUserStatus(actor, params.id, (await parseBody(req, userStatusSchema)).status)));
