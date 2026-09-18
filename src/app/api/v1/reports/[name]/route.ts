import { ok, route } from "@/lib/api";
import { authorize } from "@/lib/rbac/authorize";
import { reportToCsv, runReport } from "@/server/services/reports";

/** GET /api/v1/reports/:name?…params — `?format=csv` streams CSV (requires reports:export). */
export const GET = route<{ name: string }>(async (_req, { actor, params, query }) => {
  const q: Record<string, string> = {};
  for (const [k, v] of query.entries()) if (k !== "format") q[k] = v;
  const report = await runReport(actor, params.name, q);
  if (query.get("format") === "csv") {
    await authorize(actor, "reports:export");
    const csv = reportToCsv(report);
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${report.name}-${report.generatedAt.slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
  }
  return ok(report);
});
