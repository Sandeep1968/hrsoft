import { created, ok, parseBody, parseQuery, route } from "@/lib/api";
import { createObjective, createObjectiveSchema, listObjectives, listObjectivesSchema } from "@/server/services/performance";

export const GET = route(async (_req, { actor, query }) => ok(await listObjectives(actor, parseQuery(query, listObjectivesSchema))));
export const POST = route(async (req, { actor }) => created(await createObjective(actor, await parseBody(req, createObjectiveSchema))));
