import { ok, parseBody, route } from "@/lib/api";
import { deleteCategory, updateCategory, updateCategorySchema } from "@/server/services/expenses";

export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateCategory(actor, params.id, await parseBody(req, updateCategorySchema))));
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => ok(await deleteCategory(actor, params.id)));
