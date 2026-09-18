import { noContent, ok, parseBody, route } from "@/lib/api";
import { deleteSurvey, getSurveyForRespondent, updateSurvey, updateSurveySchema } from "@/server/services/engagement";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await getSurveyForRespondent(actor, params.id)));
export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateSurvey(actor, params.id, await parseBody(req, updateSurveySchema))));
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => {
  await deleteSurvey(actor, params.id);
  return noContent();
});
