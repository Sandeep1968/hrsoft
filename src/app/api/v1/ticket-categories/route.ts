import { created, ok, parseBody, route } from "@/lib/api";
import { createTicketCategory, listTicketCategories, ticketCategorySchema } from "@/server/services/helpdesk";

export const GET = route(async (_req, { actor }) => ok(await listTicketCategories(actor)));
export const POST = route(async (req, { actor }) => created(await createTicketCategory(actor, await parseBody(req, ticketCategorySchema))));
