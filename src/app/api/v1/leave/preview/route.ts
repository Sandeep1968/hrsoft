import { ok, parseQuery, route } from "@/lib/api";
import { leavePreviewSchema, previewLeave } from "@/server/services/leave";

/** GET ?leaveTypeId&startDate&endDate&startHalf&endHalf → live day count + validation messages. */
export const GET = route(async (_req, { actor, query }) => {
  const q = parseQuery(query, leavePreviewSchema.extend({ startHalf: leavePreviewSchema.shape.startHalf.catch(null), endHalf: leavePreviewSchema.shape.endHalf.catch(null) }));
  return ok(await previewLeave(actor, q));
});
