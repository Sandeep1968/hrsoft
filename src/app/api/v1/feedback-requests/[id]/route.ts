import { ok, parseBody, route } from "@/lib/api";
import { submitFeedback, submitFeedbackSchema } from "@/server/services/performance";

export const POST = route<{ id: string }>(async (req, { actor, params }) => ok(await submitFeedback(actor, params.id, await parseBody(req, submitFeedbackSchema))));
