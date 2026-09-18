import { created, ok, parseBody, parseQuery, route } from "@/lib/api";
import { inviteUser, inviteUserSchema, listUsers, listUsersSchema } from "@/server/services/users";

export const GET = route(async (_req, { actor, query }) => ok(await listUsers(actor, parseQuery(query, listUsersSchema))));
export const POST = route(async (req, { actor }) => created(await inviteUser(actor, await parseBody(req, inviteUserSchema))));
