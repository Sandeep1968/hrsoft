import { ok, parseBody, route } from "@/lib/api";
import { interviewFeedbackSchema, submitInterviewFeedback } from "@/server/services/hiring";

export const POST = route<{ id: string }>(async (req, { actor, params }) => ok(await submitInterviewFeedback(actor, params.id, await parseBody(req, interviewFeedbackSchema))));
