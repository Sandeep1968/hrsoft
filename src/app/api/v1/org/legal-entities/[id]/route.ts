import { ok, parseBody, route } from "@/lib/api";
import { legalEntitySchema, updateLegalEntity } from "@/server/services/org";

export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateLegalEntity(actor, params.id, await parseBody(req, legalEntitySchema.partial()))));
