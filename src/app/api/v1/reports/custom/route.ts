import { ok, parseBody, route } from "@/lib/api";
import { authorize } from "@/lib/rbac/authorize";
import { customReportSchema, runCustomReport, toCsv } from "@/server/services/reports";

/** POST body = customReportSchema; `?format=csv` returns up to 5,000 rows as CSV (requires reports:export). */
export const POST = route(async (req, { actor, query }) => {
  const input = await parseBody(req, customReportSchema);
  if (query.get("format") === "csv") {
    await authorize(actor, "reports:export");
    const page = await runCustomReport(actor, input, { forExport: true });
    return new Response(toCsv(page.items, page.columns), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="employees-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
  }
  return ok(await runCustomReport(actor, input));
});
