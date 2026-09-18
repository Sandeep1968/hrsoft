import { ok, route } from "@/lib/api";
import { requireEmployee } from "@/lib/rbac/authorize";
import { taxProjection } from "@/server/services/payroll";

/** GET ?employeeId&fy — NEW vs OLD regime projection */
export const GET = route(async (_req, { actor, query }) => ok(await taxProjection(actor, query.get("employeeId") ?? requireEmployee(actor), query.get("fy") ?? undefined)));
