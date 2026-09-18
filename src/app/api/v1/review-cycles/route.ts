import { created, ok, parseBody, route } from "@/lib/api";
import { createCycle, createCycleSchema, listCycles } from "@/server/services/performance";

export const GET = route(async (_req, { actor }) => ok(await listCycles(actor)));
export const POST = route(async (req, { actor }) => created(await createCycle(actor, await parseBody(req, createCycleSchema))));
