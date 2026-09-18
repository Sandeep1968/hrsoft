import { created, ok, parseBody, route } from "@/lib/api";
import { createStructure, listStructures, structureSchema } from "@/server/services/payroll";

export const GET = route(async (_req, { actor }) => ok(await listStructures(actor)));
export const POST = route(async (req, { actor }) => created(await createStructure(actor, await parseBody(req, structureSchema))));
