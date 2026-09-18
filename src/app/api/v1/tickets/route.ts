import { created, ok, parseBody, parseQuery, route } from "@/lib/api";
import { listTickets, listTicketsSchema, raiseTicket, raiseTicketSchema } from "@/server/services/helpdesk";

export const GET = route(async (_req, { actor, query }) => ok(await listTickets(actor, parseQuery(query, listTicketsSchema))));
export const POST = route(async (req, { actor }) => created(await raiseTicket(actor, await parseBody(req, raiseTicketSchema))));
