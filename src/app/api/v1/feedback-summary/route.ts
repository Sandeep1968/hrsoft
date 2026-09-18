import { z } from "zod";
import { ok, parseQuery, route, zUuid } from "@/lib/api";
import { feedbackSummaryForSubject } from "@/server/services/performance";

const schema = z.object({ subjectId: zUuid, cycleId: zUuid.optional() });
export const GET = route(async (_req, { actor, query }) => {
  const q = parseQuery(query, schema);
  return ok(await feedbackSummaryForSubject(actor, q.subjectId, q.cycleId));
});
