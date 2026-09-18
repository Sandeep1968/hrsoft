import { ok, parseBody, route } from "@/lib/api";
import { deleteProject, getProject, projectUpdateSchema, updateProject } from "@/server/services/projects";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await getProject(actor, params.id)));
export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateProject(actor, params.id, await parseBody(req, projectUpdateSchema))));
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => ok(await deleteProject(actor, params.id)));
