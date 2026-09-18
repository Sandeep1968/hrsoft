import { ok, route } from "@/lib/api";
import { closeSurvey } from "@/server/services/engagement";

export const POST = route<{ id: string }>(async (_req, { actor, params }) => ok(await closeSurvey(actor, params.id)));
