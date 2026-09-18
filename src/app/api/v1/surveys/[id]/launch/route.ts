import { ok, route } from "@/lib/api";
import { launchSurvey } from "@/server/services/engagement";

export const POST = route<{ id: string }>(async (_req, { actor, params }) => ok(await launchSurvey(actor, params.id)));
