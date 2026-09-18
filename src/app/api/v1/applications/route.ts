import { created, parseBody, route } from "@/lib/api";
import { applySchema, applyToJob } from "@/server/services/hiring";

export const POST = route(async (req, { actor }) => created(await applyToJob(actor, await parseBody(req, applySchema))));
