import { noContent, ok, parseBody, route } from "@/lib/api";
import { deleteCycle, getCycle, updateCycle, updateCycleSchema } from "@/server/services/performance";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await getCycle(actor, params.id)));
export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateCycle(actor, params.id, await parseBody(req, updateCycleSchema))));
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => {
  await deleteCycle(actor, params.id);
  return noContent();
});
