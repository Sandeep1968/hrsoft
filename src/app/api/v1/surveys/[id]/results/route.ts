import { ok, route } from "@/lib/api";
import { surveyResults } from "@/server/services/engagement";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await surveyResults(actor, params.id)));
