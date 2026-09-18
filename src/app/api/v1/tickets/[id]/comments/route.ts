import { created, parseBody, route } from "@/lib/api";
import { addComment, commentSchema } from "@/server/services/helpdesk";

export const POST = route<{ id: string }>(async (req, { actor, params }) => created(await addComment(actor, params.id, await parseBody(req, commentSchema))));
