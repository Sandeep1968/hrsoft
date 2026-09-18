import { noContent, ok, parseBody, route } from "@/lib/api";
import { deleteDesignation, designationSchema, updateDesignation } from "@/server/services/org";

export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateDesignation(actor, params.id, await parseBody(req, designationSchema.partial()))));
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => {
  await deleteDesignation(actor, params.id);
  return noContent();
});
