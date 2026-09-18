import { created, ok, parseBody, route } from "@/lib/api";
import { createLocation, listLocations, locationSchema } from "@/server/services/org";

export const GET = route(async (_req, { actor, query }) => ok(await listLocations(actor, query.get("all") === "1")));
export const POST = route(async (req, { actor }) => created(await createLocation(actor, await parseBody(req, locationSchema))));
