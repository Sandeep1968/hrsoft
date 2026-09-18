import { created, ok, parseBody, route } from "@/lib/api";
import { createCustomField, customFieldSchema, listCustomFields } from "@/server/services/org";

export const GET = route(async (_req, { actor, query }) => ok(await listCustomFields(actor, query.get("entity") ?? "EMPLOYEE")));
export const POST = route(async (req, { actor }) => created(await createCustomField(actor, await parseBody(req, customFieldSchema))));
