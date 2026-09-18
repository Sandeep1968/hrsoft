import { created, ok, parseBody, route } from "@/lib/api";
import { categorySchema, createCategory, listCategories } from "@/server/services/expenses";

export const GET = route(async (_req, { actor, query }) => ok(await listCategories(actor, { includeInactive: query.get("all") === "1" })));
export const POST = route(async (req, { actor }) => created(await createCategory(actor, await parseBody(req, categorySchema))));
