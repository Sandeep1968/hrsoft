import { created, ok, parseBody, route } from "@/lib/api";
import { componentSchema, createComponent, listComponents } from "@/server/services/payroll";

export const GET = route(async (_req, { actor, query }) => ok(await listComponents(actor, { includeInactive: query.get("all") === "1" })));
export const POST = route(async (req, { actor }) => created(await createComponent(actor, await parseBody(req, componentSchema))));
