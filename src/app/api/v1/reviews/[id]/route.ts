import { ok, route } from "@/lib/api";
import { getReview } from "@/server/services/performance";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await getReview(actor, params.id)));
