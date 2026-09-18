import { noContent, ok, parseBody, route } from "@/lib/api";
import { deleteTemplate, getTemplate, templateSchema, updateTemplate } from "@/server/services/onboarding";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await getTemplate(actor, params.id)));
export const PUT = route<{ id: string }>(async (req, { actor, params }) => ok(await updateTemplate(actor, params.id, await parseBody(req, templateSchema))));
export const PATCH = PUT;
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => {
  await deleteTemplate(actor, params.id);
  return noContent();
});
