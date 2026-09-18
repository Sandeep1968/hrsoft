import { ok, parseBody, route } from "@/lib/api";
import { exitEmployee, exitEmployeeSchema } from "@/server/services/employees";

export const POST = route<{ id: string }>(async (req, { actor, params }) => ok(await exitEmployee(actor, params.id, await parseBody(req, exitEmployeeSchema))));
