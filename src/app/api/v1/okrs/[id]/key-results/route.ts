import { created, parseBody, route } from "@/lib/api";
import { addKeyResult, keyResultInputSchema } from "@/server/services/performance";

export const POST = route<{ id: string }>(async (req, { actor, params }) => created(await addKeyResult(actor, params.id, await parseBody(req, keyResultInputSchema))));
