import { ok, parseBody, route } from "@/lib/api";
import { deleteRole, getRole, updateRole, updateRoleSchema } from "@/server/services/rbac";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await getRole(actor, params.id)));
export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateRole(actor, params.id, await parseBody(req, updateRoleSchema))));
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => ok(await deleteRole(actor, params.id)));
