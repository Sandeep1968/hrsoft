import { noContent, ok, parseBody, route } from "@/lib/api";
import { deleteLocation, locationSchema, updateLocation } from "@/server/services/org";

export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateLocation(actor, params.id, await parseBody(req, locationSchema.partial()))));
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => {
  await deleteLocation(actor, params.id);
  return noContent();
});
