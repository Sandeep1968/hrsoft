import { z } from "zod";
import { parseQuery, route } from "@/lib/api";
import { exportRun } from "@/server/services/payroll";

const schema = z.object({ type: z.enum(["bank", "pf", "pt", "register"]) });

/** GET ?type=bank|pf|pt|register → text/csv attachment */
export const GET = route<{ id: string }>(async (_req, { actor, params, query }) => {
  const { type } = parseQuery(query, schema);
  const { filename, content } = await exportRun(actor, params.id, type);
  return new Response(content, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });
});
