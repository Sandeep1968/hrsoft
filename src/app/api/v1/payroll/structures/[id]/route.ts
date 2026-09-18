import { ok, parseBody, route } from "@/lib/api";
import { deleteStructure, getStructure, updateStructure, updateStructureSchema } from "@/server/services/payroll";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await getStructure(actor, params.id)));
export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateStructure(actor, params.id, await parseBody(req, updateStructureSchema))));
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => ok(await deleteStructure(actor, params.id)));
