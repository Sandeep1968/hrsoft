import { created, ok, parseBody, route } from "@/lib/api";
import { createApiKey, createApiKeySchema, listApiKeys } from "@/server/services/apikeys";

export const GET = route(async (_req, { actor }) => ok(await listApiKeys(actor)));
export const POST = route(async (req, { actor }) => created(await createApiKey(actor, await parseBody(req, createApiKeySchema))));
