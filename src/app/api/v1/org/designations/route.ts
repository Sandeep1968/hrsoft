import { created, ok, parseBody, route } from "@/lib/api";
import { createDesignation, designationSchema, listDesignations } from "@/server/services/org";

export const GET = route(async (_req, { actor, query }) => ok(await listDesignations(actor, query.get("all") === "1")));
export const POST = route(async (req, { actor }) => created(await createDesignation(actor, await parseBody(req, designationSchema))));
