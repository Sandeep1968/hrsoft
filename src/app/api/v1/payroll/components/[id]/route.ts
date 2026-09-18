import { ok, parseBody, route } from "@/lib/api";
import { deleteComponent, updateComponent, updateComponentSchema } from "@/server/services/payroll";

export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateComponent(actor, params.id, await parseBody(req, updateComponentSchema))));
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => ok(await deleteComponent(actor, params.id)));
