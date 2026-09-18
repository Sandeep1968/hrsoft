import { created, ok, parseBody, route } from "@/lib/api";
import { createTask, listTasks, taskSchema } from "@/server/services/projects";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await listTasks(actor, params.id)));
export const POST = route<{ id: string }>(async (req, { actor, params }) => created(await createTask(actor, params.id, await parseBody(req, taskSchema))));
