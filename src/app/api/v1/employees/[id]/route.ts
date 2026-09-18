import { ok, parseBody, route } from "@/lib/api";
import { getEmployee, updateEmployee, updateEmployeeSchema } from "@/server/services/employees";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await getEmployee(actor, params.id)));
export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateEmployee(actor, params.id, await parseBody(req, updateEmployeeSchema))));
