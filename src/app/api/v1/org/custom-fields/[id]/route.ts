import { noContent, ok, parseBody, route } from "@/lib/api";
import { customFieldSchema, deleteCustomField, updateCustomField } from "@/server/services/org";

export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateCustomField(actor, params.id, await parseBody(req, customFieldSchema.partial()))));
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => {
  await deleteCustomField(actor, params.id);
  return noContent();
});
