import { ok, parseBody, route } from "@/lib/api";
import { getTicket, updateTicket, updateTicketSchema } from "@/server/services/helpdesk";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await getTicket(actor, params.id)));
/** PATCH { status?, assigneeId?, priority? } */
export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateTicket(actor, params.id, await parseBody(req, updateTicketSchema))));
