import Link from "next/link";
import { CalendarDays, CalendarRange, Settings2 } from "lucide-react";
import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDate, isoDate } from "@/lib/dates";
import { getBalances, listLeaveRequests, myUpcomingHolidays } from "@/server/services/leave";
import { todayIst } from "@/server/services/calendar";
import { LeaveRequestsTable } from "./leave-requests-table";

export const metadata = { title: "Leave" };

export default async function LeavePage() {
  const actor = await requireActor();
  const actions = (
    <>
      {can(actor, "leave:read", "TEAM") && (
        <Button variant="outline" nativeButton={false} render={<Link href="/leave/calendar" />}>
          <CalendarRange /> Team calendar
        </Button>
      )}
      {can(actor, "leave:manage") && (
        <Button variant="outline" nativeButton={false} render={<Link href="/leave/admin" />}>
          <Settings2 /> Admin
        </Button>
      )}
      {actor.employeeId && (
        <Button nativeButton={false} render={<Link href="/leave/apply" />}>
          <CalendarDays /> Apply leave
        </Button>
      )}
    </>
  );
  if (!actor.employeeId) {
    return (
      <div>
        <PageHeader title="Leave" description="Balances, requests and holidays." actions={actions} />
        <EmptyState title="No employee profile" description="Your account is not linked to an employee record, so there are no leave balances to show." />
      </div>
    );
  }
  const today = todayIst();
  const [balances, requests, holidays] = await Promise.all([
    getBalances(actor, actor.employeeId, today.getUTCFullYear()),
    listLeaveRequests(actor, { employeeId: actor.employeeId, page: 1, pageSize: 25, order: "desc" }),
    myUpcomingHolidays(actor, 8),
  ]);
  const pending = requests.items.filter((r) => r.status === "PENDING").length;

  return (
    <div className="grid gap-6">
      <PageHeader title="Leave" description={`${today.getUTCFullYear()} balances · ${pending} pending request${pending === 1 ? "" : "s"}`} actions={actions} />
      {balances.length === 0 ? (
        <EmptyState title="No leave balances for this year" description="HR has not allocated leave balances yet." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {balances.map((b) => (
            <Card key={b.id} size="sm">
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <span className="size-2.5 rounded-full" style={{ background: b.leaveType.color }} />
                    {b.leaveType.name}
                  </div>
                  {!b.leaveType.isPaid && <span className="text-[10px] uppercase text-muted-foreground">Unpaid</span>}
                </div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{b.available}<span className="ml-1 text-sm font-normal text-muted-foreground">available</span></div>
                <div className="mt-1 text-xs text-muted-foreground tabular-nums">Used {b.used} · Accrued {b.accrued}{b.carriedForward ? ` · CF ${b.carriedForward}` : ""}{b.adjusted ? ` · Adj ${b.adjusted > 0 ? "+" : ""}${b.adjusted}` : ""}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>My requests</CardTitle></CardHeader>
          <CardContent><LeaveRequestsTable items={requests.items} today={isoDate(today)} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Upcoming holidays</CardTitle></CardHeader>
          <CardContent>
            {holidays.length === 0 && <p className="text-sm text-muted-foreground">No upcoming holidays in your calendar.</p>}
            <ul className="space-y-2">
              {holidays.map((h) => (
                <li key={h.date} className="flex items-center justify-between text-sm">
                  <span>{h.name}{h.isOptional && <span className="ml-1 text-xs text-muted-foreground">(optional)</span>}</span>
                  <span className="text-muted-foreground">{fmtDate(h.date)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
