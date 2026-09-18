import { created, parseBody, route } from "@/lib/api";
import { respond, respondSchema } from "@/server/services/engagement";

export const POST = route<{ id: string }>(async (req, { actor, params }) => created(await respond(actor, params.id, await parseBody(req, respondSchema))));
