import { requireActor } from "@/lib/auth/session";
import { PageHeader } from "@/components/common";
import { isoDate } from "@/lib/dates";
import { getMonth } from "@/server/services/attendance";
import { todayIst } from "@/server/services/calendar";
import { MonthView } from "../../month-view";

export const metadata = { title: "Employee attendance" };

export default async function EmployeeAttendancePage({ params, searchParams }: PageProps<"/attendance/employee/[id]">) {
  const actor = await requireActor();
  const { id } = await params;
  const sp = await searchParams;
  const today = todayIst();
  const anchor = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? new Date(`${sp.date}T00:00:00Z`) : today;
  const year = Number(sp.year ?? anchor.getUTCFullYear());
  const month = Number(sp.month ?? anchor.getUTCMonth() + 1);
  const data = await getMonth(actor, id, Number.isFinite(year) ? year : today.getUTCFullYear(), Number.isFinite(month) && month >= 1 && month <= 12 ? month : today.getUTCMonth() + 1);
  return (
    <div className="grid gap-6">
      <PageHeader
        title={data.employee.displayName}
        description={`${data.employee.employeeCode} · Attendance`}
        breadcrumb={[{ label: "Attendance", href: "/attendance" }, { label: "Team", href: "/attendance/team" }, { label: data.employee.displayName }]}
      />
      <MonthView initial={data} today={isoDate(today)} readOnly basePath={`/attendance/employee/${id}`} />
    </div>
  );
}
