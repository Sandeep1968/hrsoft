import { ok, route } from "@/lib/api";
import { praiseLeaderboard } from "@/server/services/performance";

export const GET = route(async (_req, { actor, query }) => ok(await praiseLeaderboard(actor, query.get("period"))));
