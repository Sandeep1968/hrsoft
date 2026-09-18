import { ok, route } from "@/lib/api";
import { okrTree } from "@/server/services/performance";

export const GET = route(async (_req, { actor, query }) => ok(await okrTree(actor, query.get("period"))));
