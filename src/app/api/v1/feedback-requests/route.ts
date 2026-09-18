import { created, ok, parseBody, route } from "@/lib/api";
import { listFeedbackRequestsAboutMe, listMyFeedbackRequests, requestFeedback, requestFeedbackSchema } from "@/server/services/performance";

export const GET = route(async (_req, { actor, query }) => ok(query.get("about") === "me" ? await listFeedbackRequestsAboutMe(actor) : await listMyFeedbackRequests(actor)));
export const POST = route(async (req, { actor }) => created(await requestFeedback(actor, await parseBody(req, requestFeedbackSchema))));
