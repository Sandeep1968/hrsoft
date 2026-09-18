import { noContent, ok, parseBody, route } from "@/lib/api";
import { deleteDepartment, departmentSchema, updateDepartment } from "@/server/services/org";

export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateDepartment(actor, params.id, await parseBody(req, departmentSchema.partial()))));
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => {
  await deleteDepartment(actor, params.id);
  return noContent();
});
