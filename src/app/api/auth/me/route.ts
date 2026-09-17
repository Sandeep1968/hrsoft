import { ok, route } from "@/lib/api";

export const GET = route(async (_req, { actor }) => {
  return ok({
    userId: actor.userId,
    email: actor.email,
    name: actor.name,
    employeeId: actor.employeeId,
    roles: actor.roles,
    permissions: Object.fromEntries(actor.perms),
  });
});
