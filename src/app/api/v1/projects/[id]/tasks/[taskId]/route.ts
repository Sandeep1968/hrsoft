import { ok, parseBody, route } from "@/lib/api";
import { deleteTask, taskSchema, updateTask } from "@/server/services/projects";

export const PATCH = route<{ id: string; taskId: string }>(async (req, { actor, params }) => ok(await updateTask(actor, params.id, params.taskId, await parseBody(req, taskSchema.partial()))));
export const DELETE = route<{ id: string; taskId: string }>(async (_req, { actor, params }) => ok(await deleteTask(actor, params.id, params.taskId)));
