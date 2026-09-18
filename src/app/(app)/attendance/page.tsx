import Link from "next/link";
import { Settings2, Users } from "lucide-react";
import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { isoDate } from "@/lib/dates";
import { getMonth, getToday, listRegularizations, listRemoteWork } from "@/server/services/attendance";
import { todayIst } from "@/server/services/calendar";
import { ClockCard } from "./clock-card";
import { MonthView } from "./month-view";
import { RequestHistory } from "./request-history";

export const metadata = { title: "My attendance" };

export default async function AttendancePage({ searchParams }: PageProps<"/attendance">) {
  const actor = await requireActor();
  const sp = await searchParams;
  const hasTeam = can(actor, "attendance:read", "TEAM");
  const actions = (
    <>
      {hasTeam && (
        <Button variant="outline" nativeButton={false} render={<Link href="/attendance/team" />}>
          <Users /> Team
        </Button>
      )}
      {can(actor, "attendance:manage") && (
        <Button variant="outline" nativeButton={false} render={<Link href="/attendance/admin" />}>
          <Settings2 /> Admin
        </Button>
      )}
    </>
  );

  if (!actor.employeeId) {
    return (
      <div>
        <PageHeader title="Attendance" description="Clock in, review your month and raise corrections." actions={actions} />
        <EmptyState title="No employee profile" description="Your account is not linked to an employee record, so there is no attendance to show." action={hasTeam ? <Button nativeButton={false} render={<Link href="/attendance/team" />}>View team attendance</Button> : undefined} />
      </div>
    );
  }

  const today = todayIst();
  const year = Number(sp.year ?? today.getUTCFullYear());
  const month = Number(sp.month ?? today.getUTCMonth() + 1);
  const [todayData, monthData, regs, remote] = await Promise.all([
    getToday(actor),
    getMonth(actor, actor.employeeId, Number.isFinite(year) ? year : today.getUTCFullYear(), Number.isFinite(month) && month >= 1 && month <= 12 ? month : today.getUTCMonth() + 1),
    listRegularizations(actor, { employeeId: actor.employeeId, page: 1, pageSize: 10, order: "desc" }),
    listRemoteWork(actor, { employeeId: actor.employeeId, page: 1, pageSize: 10, order: "desc" }),
  ]);

  return (
    <div className="grid gap-6">
      <PageHeader title="My attendance" description="Clock in, review your month and raise corrections." actions={actions} />
      <ClockCard initial={todayData} />
      <MonthView initial={monthData} today={isoDate(today)} />
      <RequestHistory regularizations={regs.items} remote={remote.items} />
    </div>
  );
}
