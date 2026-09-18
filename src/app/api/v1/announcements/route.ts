import { created, ok, paginationSchema, parseBody, parseQuery, route } from "@/lib/api";
import { announcementSchema, createAnnouncement, listAnnouncements } from "@/server/services/engagement";

export const GET = route(async (_req, { actor, query }) => ok(await listAnnouncements(actor, parseQuery(query, paginationSchema))));
export const POST = route(async (req, { actor }) => created(await createAnnouncement(actor, await parseBody(req, announcementSchema))));
