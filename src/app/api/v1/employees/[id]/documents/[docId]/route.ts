import { noContent, ok, route } from "@/lib/api";
import { deleteDocument, documentUrl } from "@/server/services/documents";

export const GET = route<{ id: string; docId: string }>(async (_req, { actor, params }) => ok(await documentUrl(actor, params.id, params.docId)));
export const DELETE = route<{ id: string; docId: string }>(async (_req, { actor, params }) => {
  await deleteDocument(actor, params.id, params.docId);
  return noContent();
});
