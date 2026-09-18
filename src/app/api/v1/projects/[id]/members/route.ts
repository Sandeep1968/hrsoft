import { created, ok, parseBody, route, zUuid } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { addMember, memberSchema, removeMember } from "@/server/services/projects";

export const POST = route<{ id: string }>(async (req, { actor, params }) => created(await addMember(actor, params.id, await parseBody(req, memberSchema))));
export const DELETE = route<{ id: string }>(async (_req, { actor, params, query }) => {
  const employeeId = zUuid.safeParse(query.get("employeeId"));
  if (!employeeId.success) throw new ValidationError("employeeId query parameter is required");
  return ok(await removeMember(actor, params.id, employeeId.data));
});
