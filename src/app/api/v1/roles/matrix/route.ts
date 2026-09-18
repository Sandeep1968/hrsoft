import { ok, route } from "@/lib/api";
import { permissionMatrix } from "@/server/services/rbac";

export const GET = route(async (_req, { actor }) => ok(await permissionMatrix(actor)));
