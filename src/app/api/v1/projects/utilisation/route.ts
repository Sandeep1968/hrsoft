import { ok, parseQuery, route } from "@/lib/api";
import { projectUtilisation, utilisationSchema } from "@/server/services/projects";

export const GET = route(async (_req, { actor, query }) => ok(await projectUtilisation(actor, parseQuery(query, utilisationSchema))));
