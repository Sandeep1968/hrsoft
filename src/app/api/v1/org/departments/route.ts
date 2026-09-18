import { created, ok, parseBody, route } from "@/lib/api";
import { createDepartment, departmentSchema, listDepartments } from "@/server/services/org";

export const GET = route(async (_req, { actor, query }) => ok(await listDepartments(actor, query.get("all") === "1")));
export const POST = route(async (req, { actor }) => created(await createDepartment(actor, await parseBody(req, departmentSchema))));
