import { created, ok, parseBody, parseQuery, route } from "@/lib/api";
import { listRemoteWork, remoteWorkSchema, requestListSchema, requestRemoteWork } from "@/server/services/attendance";

export const GET = route(async (_req, { actor, query }) => ok(await listRemoteWork(actor, parseQuery(query, requestListSchema))));
export const POST = route(async (req, { actor }) => created(await requestRemoteWork(actor, await parseBody(req, remoteWorkSchema))));
