import { ok, route } from "@/lib/api";
import { roleOptions } from "@/server/services/rbac";

export const GET = route(async (_req, { actor }) => ok(await roleOptions(actor)));
