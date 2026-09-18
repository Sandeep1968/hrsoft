import { ok, parseQuery, route } from "@/lib/api";
import { listTeamReviews, listTeamReviewsSchema } from "@/server/services/performance";

export const GET = route<{ id: string }>(async (_req, { actor, params, query }) => ok(await listTeamReviews(actor, params.id, parseQuery(query, listTeamReviewsSchema))));
