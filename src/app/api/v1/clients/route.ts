import { z } from "zod";
import { created, ok, paginationSchema, parseBody, parseQuery, route } from "@/lib/api";
import { clientSchema, createClient, listClients } from "@/server/services/projects";

export const GET = route(async (_req, { actor, query }) => ok(await listClients(actor, parseQuery(query, paginationSchema.extend({ includeInactive: z.coerce.boolean().optional() })))));
export const POST = route(async (req, { actor }) => created(await createClient(actor, await parseBody(req, clientSchema))));
