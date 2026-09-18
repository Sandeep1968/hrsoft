import { created, ok, parseBody, route } from "@/lib/api";
import { createLegalEntity, legalEntitySchema, listLegalEntities } from "@/server/services/org";

export const GET = route(async (_req, { actor }) => ok(await listLegalEntities(actor)));
export const POST = route(async (req, { actor }) => created(await createLegalEntity(actor, await parseBody(req, legalEntitySchema))));
