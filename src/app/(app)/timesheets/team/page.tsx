import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { addDays, fmtDate, isoDate, toDateOnly, weekStart } from "@/lib/dates";
import { EmptyState, PageHeader, StatCard, StatusBadge } from "@/components/common";
import { NativeSelect } from "@/components/common/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pager } from "@/components/psa/pager";
import { listTimesheets, missingTimesheets, weeklySummary } from "@/server/services/timesheets";
import { DecideButtons } from "@/app/(app)/approvals/decide-dialog";

export const metadata = { title: "Team timesheets" };

export default async function TeamTimesheetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const canApprove = can(actor, "timesheets:approve");
  if (!can(actor, "timesheets:read", "TEAM") && !canApprove) {
    return <div><PageHeader title="Team timesheets" /><EmptyState title="No team scope" description="You need team or company-wide timesheet access to see this page." /></div>;
  }
  const week = weekStart(typeof sp.weekStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.weekStart) ? toDateOnly(sp.weekStart) : addDays(new Date(), -7));
  const status = typeof sp.status === "string" && ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"].includes(sp.status) ? (sp.status as "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED") : undefined;
  const tab = sp.tab === "all" ? "all" : "pending";

  const [summary, pending, all, missing] = await Promise.all([
    weeklySummary(actor, week),
    listTimesheets(actor, { status: "SUBMITTED", page: 1, pageSize: 100, order: "asc" }),
    tab === "all" ? listTimesheets(actor, { status, weekStart: week, q: typeof sp.q === "string" ? sp.q : undefined, page: Number(sp.page ?? 1), pageSize: 25, order: "desc" }) : null,
    canApprove && can(actor, "timesheets:approve", "TEAM") ? missingTimesheets(actor, week).catch(() => null) : null,
  ]);

  const weekHref = (d: Date, extra: Record<string, string> = {}) => `/timesheets/team?${new URLSearchParams({ weekStart: isoDate(d), tab, ...extra }).toString()}`;

  return (
    <div>
      <PageHeader title="Team timesheets" description="Approve submitted sheets and chase missing ones." breadcrumb={[{ label: "Timesheets", href: "/timesheets" }, { label: "Team" }]} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" nativeButton={false} render={<Link href={weekHref(addDays(week, -7))} />}>← Prev week</Button>
        <span className="text-sm font-medium">{fmtDate(week)} – {fmtDate(addDays(week, 6))}</span>
        <Button size="sm" variant="outline" nativeButton={false} render={<Link href={weekHref(addDays(week, 7))} />}>Next week →</Button>
        <div className="ml-auto flex gap-1 rounded-lg bg-muted p-0.5 text-sm">
          <Link href={weekHref(week, { tab: "pending" })} className={`rounded-md px-3 py-1 ${tab === "pending" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>To approve ({pending.total})</Link>
          <Link href={weekHref(week, { tab: "all" })} className={`rounded-md px-3 py-1 ${tab === "all" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>All sheets</Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Submitted" value={summary.counts.SUBMITTED} hint="awaiting decision this week" />
        <StatCard label="Approved" value={summary.counts.APPROVED} hint={`${summary.counts.REJECTED} rejected · ${summary.counts.DRAFT} draft`} />
        <StatCard label="Hours this week" value={`${summary.totalHours}h`} hint={`${summary.billableHours}h billable`} />
        <StatCard label="Missing" value={missing ? missing.items.length : "—"} hint={missing ? "project members without a submitted sheet" : "requires approve scope"} />
      </div>

      {tab === "pending" ? (
        <Card className="mt-6">
          <CardHeader><CardTitle>Waiting for approval</CardTitle></CardHeader>
          <CardContent>
            {pending.items.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to approve.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Week</TableHead><TableHead className="text-right">Hours</TableHead><TableHead>Submitted</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {pending.items.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell><Link href={`/timesheets/${t.id}`} className="font-medium hover:underline">{t.employeeName}</Link><div className="text-xs text-muted-foreground">{t.employeeCode}{t.department ? ` · ${t.department}` : ""}</div></TableCell>
                      <TableCell>{fmtDate(t.weekStart)}</TableCell>
                      <TableCell className="text-right tabular-nums">{t.totalHours}</TableCell>
                      <TableCell className="text-muted-foreground">{fmtDate(t.submittedAt)}</TableCell>
                      <TableCell className="text-right"><DecideButtons decideUrl={`/api/v1/timesheets/${t.id}/decide`} title={`${t.employeeName} · week of ${fmtDate(t.weekStart)} · ${t.totalHours}h`} size="xs" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="mt-6">
          <CardHeader><CardTitle>All sheets · week of {fmtDate(week)}</CardTitle></CardHeader>
          <CardContent>
            <form method="get" className="mb-3 flex flex-wrap gap-2">
              <input type="hidden" name="tab" value="all" /><input type="hidden" name="weekStart" value={isoDate(week)} />
              <Input name="q" placeholder="Search employee" defaultValue={typeof sp.q === "string" ? sp.q : ""} className="w-56" />
              <NativeSelect name="status" defaultValue={status ?? ""} className="w-40"><option value="">All statuses</option>{["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"].map((s) => <option key={s} value={s}>{s}</option>)}</NativeSelect>
              <Button type="submit" variant="outline" size="sm">Filter</Button>
            </form>
            {!all || all.items.length === 0 ? <p className="text-sm text-muted-foreground">No sheets match.</p> : (
              <>
                <Table>
                  <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Hours</TableHead><TableHead>Approver</TableHead><TableHead>Decided</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {all.items.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell><Link href={`/timesheets/${t.id}`} className="font-medium hover:underline">{t.employeeName}</Link><div className="text-xs text-muted-foreground">{t.employeeCode}</div></TableCell>
                        <TableCell><StatusBadge status={t.status} /></TableCell>
                        <TableCell className="text-right tabular-nums">{t.totalHours}</TableCell>
                        <TableCell>{t.approverName ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{fmtDate(t.decidedAt)}{t.decisionNote ? <span className="block max-w-56 truncate text-xs">“{t.decisionNote}”</span> : null}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Pager page={all.page} pages={all.pages} total={all.total} basePath="/timesheets/team" params={{ ...sp, tab: "all", weekStart: isoDate(week) }} />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {missing && (
        <Card className="mt-6">
          <CardHeader><CardTitle>Missing timesheets · week of {fmtDate(week)}</CardTitle></CardHeader>
          <CardContent>
            {missing.items.length === 0 ? <p className="text-sm text-muted-foreground">Everyone on an active project has submitted.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Department</TableHead><TableHead>Manager</TableHead><TableHead className="text-right">Projects</TableHead><TableHead>Sheet</TableHead></TableRow></TableHeader>
                <TableBody>
                  {missing.items.map((m) => (
                    <TableRow key={m.employeeId}>
                      <TableCell><Link href={`/timesheets?employeeId=${m.employeeId}&weekStart=${isoDate(week)}`} className="hover:underline">{m.displayName}</Link><div className="text-xs text-muted-foreground">{m.employeeCode}</div></TableCell>
                      <TableCell>{m.department ?? "—"}</TableCell>
                      <TableCell>{m.managerName ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.projects}</TableCell>
                      <TableCell>{m.status ? <StatusBadge status={m.status} /> : <span className="text-xs text-muted-foreground">Not started</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
