import { noContent, ok, parseBody, route } from "@/lib/api";
import { deleteObjective, getObjective, updateObjective, updateObjectiveSchema } from "@/server/services/performance";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await getObjective(actor, params.id)));
export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateObjective(actor, params.id, await parseBody(req, updateObjectiveSchema))));
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => {
  await deleteObjective(actor, params.id);
  return noContent();
});
