import { ok, paginationSchema, parseQuery, route } from "@/lib/api";
import { usersWithRole } from "@/server/services/rbac";

export const GET = route<{ id: string }>(async (_req, { actor, params, query }) => ok(await usersWithRole(actor, params.id, parseQuery(query, paginationSchema))));
