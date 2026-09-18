import Link from "next/link";
import { CalendarRange, CheckSquare, Users } from "lucide-react";
import { requireActor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { can, teamIds } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader, StatCard, StatusBadge } from "@/components/common";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayIst } from "@/server/services/calendar";
import { fmtMinutes, fmtTime } from "../attendance/format";

export const metadata = { title: "My team" };

export default async function TeamPage() {
  const actor = await requireActor();
  if (!actor.employeeId) {
    return (
      <div>
        <PageHeader title="My team" />
        <EmptyState title="No employee profile" description="Team views are available to managers with an employee record." />
      </div>
    );
  }
  const today = todayIst();
  const year = today.getUTCFullYear();
  const [reports, allIds] = await Promise.all([
    db.employee.findMany({
      where: { managerId: actor.employeeId, status: { not: "EXITED" } },
      orderBy: { displayName: "asc" },
      select: {
        id: true,
        displayName: true,
        employeeCode: true,
        photoUrl: true,
        designation: { select: { name: true } },
        department: { select: { name: true } },
        attendance: { where: { date: today }, take: 1, select: { status: true, firstIn: true, lastOut: true, workMinutes: true } },
        leaveBalances: { where: { year, leaveType: { code: { in: ["CL", "SL", "EL"] } } }, select: { opening: true, accrued: true, carriedForward: true, adjusted: true, used: true, leaveType: { select: { code: true } } } },
        _count: { select: { reports: true } },
      },
    }),
    teamIds(actor),
  ]);
  if (reports.length === 0) {
    return (
      <div>
        <PageHeader title="My team" />
        <EmptyState title="No direct reports" description="Employees whose manager is you will appear here." />
      </div>
    );
  }
  const ids = reports.map((r) => r.id);
  const [leavePending, regPending, remotePending, expPending, tsPending, onLeaveToday] = await Promise.all([
    db.leaveRequest.groupBy({ by: ["employeeId"], where: { employeeId: { in: ids }, status: "PENDING" }, _count: { _all: true } }),
    db.regularizationRequest.groupBy({ by: ["employeeId"], where: { employeeId: { in: ids }, status: "PENDING" }, _count: { _all: true } }),
    db.remoteWorkRequest.groupBy({ by: ["employeeId"], where: { employeeId: { in: ids }, status: "PENDING" }, _count: { _all: true } }),
    can(actor, "expenses:approve") ? db.expenseClaim.groupBy({ by: ["employeeId"], where: { employeeId: { in: ids }, status: "SUBMITTED" }, _count: { _all: true } }) : [],
    can(actor, "timesheets:approve") ? db.timesheet.groupBy({ by: ["employeeId"], where: { employeeId: { in: ids }, status: "SUBMITTED" }, _count: { _all: true } }) : [],
    db.leaveRequest.findMany({ where: { employeeId: { in: ids }, status: "APPROVED", startDate: { lte: today }, endDate: { gte: today } }, select: { employeeId: true, leaveType: { select: { code: true } } } }),
  ]);
  const pendingBy = new Map<string, number>();
  for (const g of [...leavePending, ...regPending, ...remotePending, ...expPending, ...tsPending]) pendingBy.set(g.employeeId, (pendingBy.get(g.employeeId) ?? 0) + g._count._all);
  const totalPending = [...pendingBy.values()].reduce((a, b) => a + b, 0);
  const present = reports.filter((r) => ["PRESENT", "WFH", "HALF_DAY"].includes(r.attendance[0]?.status ?? "")).length;
  const onLeave = new Map(onLeaveToday.map((l) => [l.employeeId, l.leaveType.code]));

  return (
    <div className="grid gap-6">
      <PageHeader
        title="My team"
        description={`${reports.length} direct report${reports.length === 1 ? "" : "s"} · ${allIds.size} in your reporting line`}
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/attendance/team" />}><Users /> Team attendance</Button>
            <Button variant="outline" nativeButton={false} render={<Link href="/leave/calendar" />}><CalendarRange /> Leave calendar</Button>
            <Button nativeButton={false} render={<Link href="/approvals" />}><CheckSquare /> Approvals{totalPending ? ` (${totalPending})` : ""}</Button>
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Present today" value={`${present} / ${reports.length}`} hint="Present, WFH or half day" />
        <StatCard label="On leave today" value={onLeave.size} hint={[...onLeave.values()].join(", ") || "Nobody"} />
        <StatCard label="Pending requests" value={totalPending} hint="Leave, regularisation, WFH, expenses, timesheets" />
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Today</TableHead>
              <TableHead>In / out</TableHead>
              <TableHead>Leave balance</TableHead>
              <TableHead className="text-right">Pending</TableHead>
              <TableHead className="text-right">Reports</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {reports.map((r) => {
              const a = r.attendance[0];
              const bal = r.leaveBalances.map((b) => `${b.leaveType.code} ${Number(b.opening) + Number(b.accrued) + Number(b.carriedForward) + Number(b.adjusted) - Number(b.used)}`).join(" · ");
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/employees/${r.id}`} className="flex items-center gap-2 hover:underline">
                      <Avatar size="sm">{r.photoUrl && <AvatarImage src={r.photoUrl} alt="" />}<AvatarFallback>{r.displayName.slice(0, 1)}</AvatarFallback></Avatar>
                      <span><span className="block font-medium">{r.displayName}</span><span className="block text-xs text-muted-foreground">{r.employeeCode}</span></span>
                    </Link>
                  </TableCell>
                  <TableCell>{r.designation?.name ?? "—"}<span className="block text-xs text-muted-foreground">{r.department?.name ?? ""}</span></TableCell>
                  <TableCell>{a ? <StatusBadge status={a.status} /> : onLeave.has(r.id) ? <StatusBadge status="ON_LEAVE" /> : <span className="text-xs text-muted-foreground">Not clocked in</span>}</TableCell>
                  <TableCell className="tabular-nums text-xs">{a?.firstIn ? `${fmtTime(a.firstIn.toISOString())} – ${a.lastOut ? fmtTime(a.lastOut.toISOString()) : "…"}` : "—"}{a?.workMinutes ? <span className="block text-muted-foreground">{fmtMinutes(a.workMinutes)}</span> : null}</TableCell>
                  <TableCell className="text-xs tabular-nums">{bal || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{pendingBy.get(r.id) ?? 0}</TableCell>
                  <TableCell className="text-right tabular-nums">{r._count.reports}</TableCell>
                  <TableCell className="text-right"><Button size="xs" variant="ghost" nativeButton={false} render={<Link href={`/attendance/employee/${r.id}`} />}>Attendance</Button></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
