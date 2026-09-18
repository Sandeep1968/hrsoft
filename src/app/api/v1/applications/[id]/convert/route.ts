import { created, parseBody, route } from "@/lib/api";
import { convertSchema, convertToEmployee } from "@/server/services/hiring";

export const POST = route<{ id: string }>(async (req, { actor, params }) => created(await convertToEmployee(actor, params.id, await parseBody(req, convertSchema))));
