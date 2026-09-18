import { requireActor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader } from "@/components/common";
import { listHolidayCalendars, listRegularizations, listRemoteWork, listShifts } from "@/server/services/attendance";
import { AttendanceAdminTabs } from "./admin-tabs";

export const metadata = { title: "Attendance admin" };

export default async function AttendanceAdminPage({ searchParams }: PageProps<"/attendance/admin">) {
  const actor = await requireActor();
  if (!can(actor, "attendance:manage")) {
    return (
      <div>
        <PageHeader title="Attendance admin" breadcrumb={[{ label: "Attendance", href: "/attendance" }, { label: "Admin" }]} />
        <EmptyState title="Not permitted" description="You need the attendance:manage permission to open this page." />
      </div>
    );
  }
  const sp = await searchParams;
  const [shifts, departments, locations, calendars, regs, remote] = await Promise.all([
    listShifts(actor, { includeInactive: true }),
    db.department.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    listHolidayCalendars(actor),
    listRegularizations(actor, { status: "PENDING", page: 1, pageSize: 100, order: "asc" }),
    listRemoteWork(actor, { status: "PENDING", page: 1, pageSize: 100, order: "asc" }),
  ]);
  return (
    <div>
      <PageHeader title="Attendance admin" description="Shifts, holiday calendars, the regularisation queue and record corrections." breadcrumb={[{ label: "Attendance", href: "/attendance" }, { label: "Admin" }]} />
      <AttendanceAdminTabs
        shifts={shifts.map((s) => ({ ...s, _count: undefined }))}
        departments={departments}
        locations={locations}
        calendars={calendars}
        regularizations={regs.items}
        remote={remote.items}
        defaultTab={typeof sp.tab === "string" ? sp.tab : undefined}
      />
    </div>
  );
}
