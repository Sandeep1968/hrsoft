import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { NotFoundError } from "@/lib/errors";
import { MONTHS, todayUtc } from "@/lib/dates";
import { PageHeader, StatCard } from "@/components/common";
import { NativeSelect } from "@/components/common/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { REPORT_CATALOGUE, reportLookups, runReport, type ReportResult } from "@/server/services/reports";
import { ReportChart } from "./report-chart";

export const metadata = { title: "Report" };

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("en-IN") : v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return String(v).replaceAll("_", " ");
}
const label = (c: string) => c.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).replace("Pct", "%");

function SimpleTable({ rows, columns }: { rows: Record<string, unknown>[]; columns?: string[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No rows.</p>;
  const cols = columns ?? Object.keys(rows[0]);
  return (
    <Table>
      <TableHeader><TableRow>{cols.map((c) => <TableHead key={c} className={typeof rows[0][c] === "number" ? "text-right" : ""}>{label(c)}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{rows.map((r, i) => <TableRow key={i}>{cols.map((c) => <TableCell key={c} className={typeof r[c] === "number" ? "text-right tabular-nums" : ""}>{fmtCell(r[c])}</TableCell>)}</TableRow>)}</TableBody>
    </Table>
  );
}

function Filters({ name, sp, lookups }: { name: string; sp: Record<string, string | string[] | undefined>; lookups: { departments: { id: string; name: string }[] } }) {
  const v = (k: string, d = "") => (typeof sp[k] === "string" ? (sp[k] as string) : d);
  const today = todayUtc();
  const years = Array.from({ length: 5 }, (_, i) => today.getUTCFullYear() - i);
  switch (name) {
    case "headcount":
      return (<><label className="grid gap-1 text-xs">As of<Input type="date" name="asOf" defaultValue={v("asOf")} /></label><label className="grid gap-1 text-xs">Group by<NativeSelect name="groupBy" defaultValue={v("groupBy", "department")}>{["department", "location", "employmentType", "gender", "designation"].map((g) => <option key={g} value={g}>{label(g)}</option>)}</NativeSelect></label></>);
    case "headcount-trend":
      return <label className="grid gap-1 text-xs">Months<NativeSelect name="months" defaultValue={v("months", "12")}>{[6, 12, 18, 24, 36].map((m) => <option key={m} value={m}>{m}</option>)}</NativeSelect></label>;
    case "attrition":
    case "expenses":
      return (<><label className="grid gap-1 text-xs">From<Input type="date" name="from" defaultValue={v("from")} /></label><label className="grid gap-1 text-xs">To<Input type="date" name="to" defaultValue={v("to")} /></label></>);
    case "attendance-summary":
      return (<><label className="grid gap-1 text-xs">Year<NativeSelect name="year" defaultValue={v("year", String(today.getUTCFullYear()))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</NativeSelect></label><label className="grid gap-1 text-xs">Month<NativeSelect name="month" defaultValue={v("month", String(today.getUTCMonth() + 1))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</NativeSelect></label><label className="grid gap-1 text-xs">Department<NativeSelect name="departmentId" defaultValue={v("departmentId")}><option value="">All</option>{lookups.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</NativeSelect></label></>);
    case "leave-utilisation":
    case "payroll-cost":
      return <label className="grid gap-1 text-xs">Year<NativeSelect name="year" defaultValue={v("year", String(today.getUTCFullYear()))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</NativeSelect></label>;
    default:
      return null;
  }
}

function Extras({ r }: { r: ReportResult }) {
  const e = r.extras as Record<string, unknown>;
  const blocks: { title: string; rows: Record<string, unknown>[] }[] = [];
  if (Array.isArray(e.reasons)) blocks.push({ title: "Exit reasons", rows: e.reasons as Record<string, unknown>[] });
  if (Array.isArray(e.topDepartments)) blocks.push({ title: "Departments using the most leave", rows: e.topDepartments as Record<string, unknown>[] });
  if (Array.isArray(e.byDepartment)) blocks.push({ title: r.name === "payroll-cost" ? `Latest finalised run by department${e.latestRun ? ` (${(e.latestRun as { month: number; year: number }).month}/${(e.latestRun as { year: number }).year})` : ""}` : "By department", rows: e.byDepartment as Record<string, unknown>[] });
  if (Array.isArray(e.byStatus)) blocks.push({ title: "By status", rows: e.byStatus as Record<string, unknown>[] });
  if (Array.isArray(e.ageBands)) blocks.push({ title: "Age bands", rows: e.ageBands as Record<string, unknown>[] });
  if (Array.isArray(e.tenureBands)) blocks.push({ title: "Tenure bands", rows: e.tenureBands as Record<string, unknown>[] });
  if (blocks.length === 0) return null;
  return <div className="grid gap-4 lg:grid-cols-2">{blocks.map((b) => <Card key={b.title}><CardHeader><CardTitle>{b.title}</CardTitle></CardHeader><CardContent><SimpleTable rows={b.rows} /></CardContent></Card>)}</div>;
}

function Stats({ r }: { r: ReportResult }) {
  const e = r.extras as Record<string, unknown>;
  const cards: { label: string; value: string; hint?: string }[] = [];
  const num = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-IN") : "—");
  const money = (v: unknown) => (typeof v === "number" ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v) : "—");
  if (r.name === "headcount") cards.push({ label: "Headcount", value: num(e.total), hint: `as of ${String(r.params.asOf)}` });
  if (r.name === "attrition" && e.total) { const t = e.total as { exits: number; avgHeadcount: number; attritionPct: number; avgTenureYears: number | null }; cards.push({ label: "Attrition", value: `${t.attritionPct}%`, hint: `${t.exits} exits / avg headcount ${t.avgHeadcount}` }, { label: "Avg tenure at exit", value: t.avgTenureYears === null ? "—" : `${t.avgTenureYears} yrs` }); }
  if (r.name === "tenure-diversity" && e.tenure) { const t = e.tenure as { avgYears: number; medianYears: number; headcount: number }; const g = e.genderTotals as { male: number; female: number }; cards.push({ label: "Avg tenure", value: `${t.avgYears} yrs`, hint: `median ${t.medianYears} yrs` }, { label: "Female share", value: t.headcount ? `${Math.round((g.female / t.headcount) * 100)}%` : "—", hint: `${g.female} of ${t.headcount}` }); }
  if (r.name === "payroll-cost" && e.totals) { const t = e.totals as { gross: number; net: number; employerCost: number }; cards.push({ label: "Gross (YTD)", value: money(t.gross) }, { label: "Net (YTD)", value: money(t.net) }, { label: "Employer cost", value: money(t.employerCost) }); }
  if (r.name === "expenses" && e.totals) { const t = e.totals as { claims: number; amount: number }; cards.push({ label: "Claims", value: num(t.claims) }, { label: "Amount", value: money(t.amount) }); }
  if (r.name === "headcount-trend") { const last = r.table.at(-1) as { headcount?: number; joins?: number; exits?: number } | undefined; if (last) cards.push({ label: "Current headcount", value: num(last.headcount) }, { label: "Joiners (period)", value: num(r.table.reduce((a, x) => a + Number(x.joins ?? 0), 0)) }, { label: "Exits (period)", value: num(r.table.reduce((a, x) => a + Number(x.exits ?? 0), 0)) }); }
  if (cards.length === 0) return null;
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map((c) => <StatCard key={c.label} label={c.label} value={c.value} hint={c.hint} />)}</div>;
}

export default async function ReportPage({ params, searchParams }: { params: Promise<{ name: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor();
  const { name } = await params;
  const sp = await searchParams;
  const entry = REPORT_CATALOGUE.find((r) => r.name === name);
  if (!entry) notFound();
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v !== "") query[k] = v;
  let report: ReportResult;
  let error: string | null = null;
  const lookups = await reportLookups(actor);
  try {
    report = await runReport(actor, name, query);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    error = e instanceof Error ? e.message : "Could not run report";
    report = { name: entry.name, title: entry.title, params: query, generatedAt: new Date().toISOString(), table: [], columns: [], extras: {} };
  }
  const csvHref = `/api/v1/reports/${name}?${new URLSearchParams({ ...query, format: "csv" }).toString()}`;
  return (
    <div>
      <PageHeader
        title={entry.title}
        description={entry.description}
        breadcrumb={[{ label: "Reports", href: "/reports" }, { label: entry.title }]}
        actions={can(actor, "reports:export") && <Button variant="outline" nativeButton={false} render={<a href={csvHref} download />}><Download /> Export CSV</Button>}
      />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <Filters name={name} sp={sp} lookups={lookups} />
        <Button type="submit" variant="outline">Run</Button>
        <Button type="button" variant="ghost" nativeButton={false} render={<Link href={`/reports/${name}`} />}>Reset</Button>
      </form>
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">{error}</div> : (
        <div className="grid gap-4">
          <Stats r={report} />
          <Card><CardHeader><CardTitle>Chart</CardTitle></CardHeader><CardContent><ReportChart report={report} /></CardContent></Card>
          <Card><CardHeader><CardTitle>Data</CardTitle></CardHeader><CardContent><SimpleTable rows={report.table} columns={report.columns} /><p className="mt-2 text-xs text-muted-foreground">Generated {new Date(report.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</p></CardContent></Card>
          <Extras r={report} />
        </div>
      )}
    </div>
  );
}
