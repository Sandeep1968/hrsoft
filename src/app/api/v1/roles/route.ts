import { created, ok, parseBody, route } from "@/lib/api";
import { createRole, createRoleSchema, listRoles } from "@/server/services/rbac";

export const GET = route(async (_req, { actor }) => ok(await listRoles(actor)));
export const POST = route(async (req, { actor }) => created(await createRole(actor, await parseBody(req, createRoleSchema))));
