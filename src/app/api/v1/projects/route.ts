import { created, ok, parseBody, parseQuery, route } from "@/lib/api";
import { createProject, listProjects, listProjectsSchema, projectSchema } from "@/server/services/projects";

export const GET = route(async (_req, { actor, query }) => ok(await listProjects(actor, parseQuery(query, listProjectsSchema))));
export const POST = route(async (req, { actor }) => created(await createProject(actor, await parseBody(req, projectSchema))));
