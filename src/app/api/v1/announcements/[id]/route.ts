import { noContent, ok, parseBody, route } from "@/lib/api";
import { deleteAnnouncement, updateAnnouncement, updateAnnouncementSchema } from "@/server/services/engagement";

export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateAnnouncement(actor, params.id, await parseBody(req, updateAnnouncementSchema))));
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => {
  await deleteAnnouncement(actor, params.id);
  return noContent();
});
