import { created, parseBody, route } from "@/lib/api";
import { punch, punchSchema } from "@/server/services/attendance";

export const POST = route(async (req, { actor }) => created(await punch(actor, await parseBody(req, punchSchema))));
