import { ok, parseBody, route } from "@/lib/api";
import { submitReviewSchema, submitSelfReview } from "@/server/services/performance";

export const POST = route<{ id: string }>(async (req, { actor, params }) => ok(await submitSelfReview(actor, params.id, await parseBody(req, submitReviewSchema))));
