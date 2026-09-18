import { created, ok, parseBody, route } from "@/lib/api";
import { createSurvey, createSurveySchema, listSurveys } from "@/server/services/engagement";

export const GET = route(async (_req, { actor }) => ok(await listSurveys(actor)));
export const POST = route(async (req, { actor }) => created(await createSurvey(actor, await parseBody(req, createSurveySchema))));
