import { ok, parseBody, route } from "@/lib/api";
import { assignRoles, assignRolesSchema } from "@/server/services/rbac";

export const PUT = route<{ id: string }>(async (req, { actor, params }) => ok(await assignRoles(actor, params.id, (await parseBody(req, assignRolesSchema)).roleKeys)));
