import { ok, parseBody, route } from "@/lib/api";
import { deleteTicketCategory, ticketCategorySchema, updateTicketCategory } from "@/server/services/helpdesk";

export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateTicketCategory(actor, params.id, await parseBody(req, ticketCategorySchema.partial()))));
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => ok(await deleteTicketCategory(actor, params.id)));
