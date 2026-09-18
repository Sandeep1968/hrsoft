import { ok, route } from "@/lib/api";
import { getMyReview } from "@/server/services/performance";

export const GET = route(async (_req, { actor, query }) => ok(await getMyReview(actor, query.get("cycleId"))));
