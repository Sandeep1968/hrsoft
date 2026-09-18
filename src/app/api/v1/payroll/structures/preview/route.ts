import { ok, parseBody, route } from "@/lib/api";
import { previewStructure, previewStructureSchema } from "@/server/services/payroll";

export const POST = route(async (req, { actor }) => ok(await previewStructure(actor, await parseBody(req, previewStructureSchema))));
