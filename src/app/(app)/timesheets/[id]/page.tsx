import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { DL, PageHeader, StatusBadge } from "@/components/common";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTimesheet } from "@/server/services/timesheets";
import { DecideButtons } from "@/app/(app)/approvals/decide-dialog";

export const metadata = { title: "Timesheet" };

export default async function TimesheetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  let t;
  try {
    t = await getTimesheet(actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const byProject = new Map<string, number>();
  for (const e of t.entries) byProject.set(e.projectCode, (byProject.get(e.projectCode) ?? 0) + e.hours);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={`${t.employeeName ?? "Timesheet"} · week of ${fmtDate(t.weekStart)}`}
        description={`${t.employeeCode ?? ""}${t.department ? ` · ${t.department}` : ""} · ${t.totalHours}h`}
        breadcrumb={[{ label: "Timesheets", href: "/timesheets" }, { label: "Team", href: "/timesheets/team" }, { label: fmtDate(t.weekStart) }]}
        actions={
          <>
            <StatusBadge status={t.status} className="text-sm" />
            {t.canDecide && <DecideButtons decideUrl={`/api/v1/timesheets/${t.id}/decide`} title={`${t.employeeName} · ${t.totalHours}h`} />}
            <Button variant="outline" nativeButton={false} render={<Link href={`/timesheets?employeeId=${t.employeeId}&weekStart=${t.weekStart}`} />}>Open grid</Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Entries</CardTitle></CardHeader>
          <CardContent>
            {t.entries.length === 0 ? <p className="text-sm text-muted-foreground">No entries.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Project</TableHead><TableHead>Task</TableHead><TableHead className="text-right">Hours</TableHead><TableHead>Note</TableHead></TableRow></TableHeader>
                <TableBody>
                  {t.entries.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{fmtDate(e.date)}</TableCell>
                      <TableCell>{e.projectCode} <span className="text-muted-foreground">{e.projectName}</span></TableCell>
                      <TableCell>{e.taskName ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{e.hours}{e.isBillable ? "" : <span className="ml-1 text-xs text-muted-foreground">NB</span>}</TableCell>
                      <TableCell className="max-w-48 whitespace-normal text-muted-foreground">{e.note ?? ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
          <CardContent>
            <DL items={[
              { label: "Status", value: <StatusBadge status={t.status} /> },
              { label: "Total", value: `${t.totalHours}h` },
              { label: "Submitted", value: fmtDateTime(t.submittedAt) },
              { label: "Approver", value: t.approverName ?? "—" },
              { label: "Decided", value: fmtDateTime(t.decidedAt) },
              { label: "Note", value: t.decisionNote ?? "—" },
            ]} />
            <div className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">By project</div>
            <ul className="mt-1 space-y-1 text-sm">{[...byProject].map(([code, h]) => <li key={code} className="flex justify-between"><span>{code}</span><span className="tabular-nums">{h}h</span></li>)}</ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
