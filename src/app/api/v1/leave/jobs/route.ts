import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { triggerMonthlyAccrual, triggerYearEndCarryForward } from "@/server/services/leave";

/** POST { job: "carry_forward", year } | { job: "accrual", year, month } — leave:manage (ALL). */
export const POST = route(async (req, { actor }) => {
  const body = await parseBody(
    req,
    z.discriminatedUnion("job", [
      z.object({ job: z.literal("carry_forward"), year: z.number().int().min(2000).max(2100) }),
      z.object({ job: z.literal("accrual"), year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12) }),
    ]),
  );
  if (body.job === "carry_forward") return ok(await triggerYearEndCarryForward(actor, body.year));
  return ok(await triggerMonthlyAccrual(actor, body.year, body.month));
});
