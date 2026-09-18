import { ok, parseBody, route } from "@/lib/api";
import { submitManagerReview, submitReviewSchema } from "@/server/services/performance";

export const POST = route<{ id: string }>(async (req, { actor, params }) => ok(await submitManagerReview(actor, params.id, await parseBody(req, submitReviewSchema))));
