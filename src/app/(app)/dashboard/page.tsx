import Link from "next/link";
import { CalendarDays, Clock, Receipt, Users, Wallet, CheckSquare, Megaphone, Cake } from "lucide-react";
import { requireActor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { can, teamIds } from "@/lib/rbac/authorize";
import { PageHeader, StatCard, StatusBadge } from "@/components/common";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fmtDate, todayUtc } from "@/lib/dates";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const actor = await requireActor();
  const today = todayUtc();
  const empId = actor.employeeId;

  const [me, todayAttendance, leaveBalances, pendingApprovals, announcements, birthdays, headcount, openTickets] = await Promise.all([
    empId ? db.employee.findUnique({ where: { id: empId }, select: { displayName: true, designation: { select: { name: true } }, department: { select: { name: true } }, manager: { select: { displayName: true } } } }) : null,
    empId ? db.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: empId, date: today } }, select: { status: true, firstIn: true, lastOut: true, workMinutes: true } }) : null,
    empId ? db.leaveBalance.findMany({ where: { employeeId: empId, year: today.getUTCFullYear() }, select: { accrued: true, opening: true, carriedForward: true, adjusted: true, used: true, leaveType: { select: { name: true, code: true, color: true } } }, orderBy: { leaveType: { code: "asc" } } }) : [],
    empId && (can(actor, "leave:approve") || can(actor, "expenses:approve"))
      ? (async () => {
          const ids = [...(await teamIds(actor))];
          if (ids.length === 0 && !can(actor, "leave:approve", "ALL")) return { leave: 0, expenses: 0, regularizations: 0, timesheets: 0 };
          const scope = can(actor, "leave:approve", "ALL") ? {} : { employeeId: { in: ids } };
          const [leave, expenses, regularizations, timesheets] = await Promise.all([
            can(actor, "leave:approve") ? db.leaveRequest.count({ where: { status: "PENDING", ...scope } }) : 0,
            can(actor, "expenses:approve") ? db.expenseClaim.count({ where: { status: "SUBMITTED", ...(can(actor, "expenses:approve", "ALL") ? {} : { employeeId: { in: ids } }) } }) : 0,
            can(actor, "attendance:approve") ? db.regularizationRequest.count({ where: { status: "PENDING", ...(can(actor, "attendance:approve", "ALL") ? {} : { employeeId: { in: ids } }) } }) : 0,
            can(actor, "timesheets:approve") ? db.timesheet.count({ where: { status: "SUBMITTED", ...(can(actor, "timesheets:approve", "ALL") ? {} : { employeeId: { in: ids } }) } }) : 0,
          ]);
          return { leave, expenses, regularizations, timesheets };
        })()
      : null,
    db.announcement.findMany({ where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: [{ isPinned: "desc" }, { publishedAt: "desc" }], take: 5, select: { id: true, title: true, body: true, publishedAt: true, isPinned: true, author: { select: { displayName: true } } } }),
    db.$queryRaw<{ displayName: string; dateOfBirth: Date }[]>`
      SELECT "displayName", "dateOfBirth" FROM "Employee"
      WHERE status = 'ACTIVE' AND "dateOfBirth" IS NOT NULL
        AND to_char("dateOfBirth", 'MM-DD') BETWEEN to_char(CURRENT_DATE, 'MM-DD') AND to_char(CURRENT_DATE + 7, 'MM-DD')
      ORDER BY to_char("dateOfBirth", 'MM-DD') LIMIT 8`,
    can(actor, "reports:view", "ALL") ? db.employee.groupBy({ by: ["status"], _count: { _all: true } }) : null,
    can(actor, "helpdesk:agent") ? db.ticket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] }, ...(can(actor, "helpdesk:agent", "ALL") ? {} : { assigneeId: empId ?? undefined }) } }) : null,
  ]);

  const totalPending = pendingApprovals ? Object.values(pendingApprovals).reduce((a, b) => a + b, 0) : 0;
  const active = headcount?.find((h) => h.status === "ACTIVE")?._count._all ?? 0;

  return (
    <div>
      <PageHeader
        title={`Good ${greeting()}, ${actor.name.split(" ")[0]}`}
        description={me ? `${me.designation?.name ?? ""}${me.department ? ` · ${me.department.name}` : ""}${me.manager ? ` · Reports to ${me.manager.displayName}` : ""}` : "Administrator account (no employee profile)"}
        actions={
          empId && (
            <>
              <Button variant="outline" nativeButton={false} render={<Link href="/attendance" />}>
                <Clock /> Attendance
              </Button>
              <Button nativeButton={false} render={<Link href="/leave/apply" />}>
                <CalendarDays /> Apply leave
              </Button>
            </>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {empId && (
          <StatCard
            label="Today"
            value={todayAttendance ? <StatusBadge status={todayAttendance.status} className="text-base" /> : <span className="text-base text-muted-foreground">Not clocked in</span>}
            hint={todayAttendance?.firstIn ? `In ${new Date(todayAttendance.firstIn).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}${todayAttendance.lastOut ? ` · Out ${new Date(todayAttendance.lastOut).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}` : ""}` : "Use the Attendance page to clock in"}
            icon={<Clock className="size-5" />}
          />
        )}
        {pendingApprovals && (
          <StatCard label="Pending approvals" value={totalPending} hint={`${pendingApprovals.leave} leave · ${pendingApprovals.expenses} expenses · ${pendingApprovals.regularizations} regularisations · ${pendingApprovals.timesheets} timesheets`} icon={<CheckSquare className="size-5" />} />
        )}
        {headcount && <StatCard label="Active headcount" value={active.toLocaleString("en-IN")} hint={headcount.filter((h) => h.status !== "ACTIVE").map((h) => `${h._count._all} ${h.status.toLowerCase().replace("_", " ")}`).join(" · ") || "All active"} icon={<Users className="size-5" />} />}
        {openTickets !== null && <StatCard label="Open tickets" value={openTickets} hint="Assigned to you or your queue" icon={<Receipt className="size-5" />} />}
        {empId && leaveBalances.length > 0 && (
          <StatCard
            label="Leave balance"
            value={leaveBalances.filter((b) => ["CL", "SL", "EL"].includes(b.leaveType.code)).map((b) => `${b.leaveType.code} ${available(b)}`).join(" · ")}
            hint="Casual · Sick · Earned (days available)"
            icon={<Wallet className="size-5" />}
          />
        )}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base"><Megaphone className="size-4" /> Announcements</CardTitle>
            <Link href="/engagement" className="text-sm text-muted-foreground hover:underline">View all</Link>
          </CardHeader>
          <CardContent className="space-y-4">
            {announcements.length === 0 && <p className="text-sm text-muted-foreground">No announcements yet.</p>}
            {announcements.map((a) => (
              <div key={a.id} className="border-b pb-3 last:border-0 last:pb-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {a.isPinned && <span className="rounded bg-primary/10 px-1.5 text-[10px] uppercase text-primary">Pinned</span>}
                  {a.title}
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{a.body}</p>
                <div className="mt-1 text-xs text-muted-foreground">{a.author?.displayName ?? "HR"} · {fmtDate(a.publishedAt)}</div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Cake className="size-4" /> Birthdays this week</CardTitle>
          </CardHeader>
          <CardContent>
            {birthdays.length === 0 && <p className="text-sm text-muted-foreground">No birthdays in the next 7 days.</p>}
            <ul className="space-y-2">
              {birthdays.map((b) => (
                <li key={b.displayName + String(b.dateOfBirth)} className="flex items-center justify-between text-sm">
                  <span>{b.displayName}</span>
                  <span className="text-muted-foreground">{new Date(b.dateOfBirth).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" })}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function greeting() {
  const h = Number(new Date().toLocaleString("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }));
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

function available(b: { opening: unknown; accrued: unknown; carriedForward: unknown; adjusted: unknown; used: unknown }) {
  return Number(b.opening) + Number(b.accrued) + Number(b.carriedForward) + Number(b.adjusted) - Number(b.used);
}
