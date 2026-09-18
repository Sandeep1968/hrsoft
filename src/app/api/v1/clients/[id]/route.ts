import { ok, parseBody, route } from "@/lib/api";
import { clientSchema, deleteClient, getClient, updateClient } from "@/server/services/projects";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await getClient(actor, params.id)));
export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateClient(actor, params.id, await parseBody(req, clientSchema.partial()))));
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => ok(await deleteClient(actor, params.id)));
