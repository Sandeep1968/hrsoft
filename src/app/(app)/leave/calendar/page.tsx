import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader } from "@/components/common";
import { eachDay, isoDate, MONTHS, monthRange } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { teamLeaveCalendar } from "@/server/services/leave";
import { todayIst } from "@/server/services/calendar";
import { CalendarNav } from "./calendar-nav";

export const metadata = { title: "Team leave calendar" };

export default async function LeaveCalendarPage({ searchParams }: PageProps<"/leave/calendar">) {
  const actor = await requireActor();
  if (!can(actor, "leave:read", "TEAM")) {
    return (
      <div>
        <PageHeader title="Team leave calendar" breadcrumb={[{ label: "Leave", href: "/leave" }, { label: "Calendar" }]} />
        <EmptyState title="No team visibility" description="The team leave calendar is available to managers and HR." />
      </div>
    );
  }
  const sp = await searchParams;
  const today = todayIst();
  const year = Number(sp.year) || today.getUTCFullYear();
  const month = Math.min(12, Math.max(1, Number(sp.month) || today.getUTCMonth() + 1));
  const departmentId = typeof sp.departmentId === "string" && sp.departmentId ? sp.departmentId : undefined;
  const { start, end } = monthRange(year, month);
  const [items, departments] = await Promise.all([
    teamLeaveCalendar(actor, { from: start, to: end, departmentId }),
    db.department.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const days = [...eachDay(start, end)];
  // Group by employee so each person is one row.
  const rows = new Map<string, { employee: (typeof items)[number]["employee"]; leaves: typeof items }>();
  for (const it of items) {
    const r = rows.get(it.employee.id) ?? { employee: it.employee, leaves: [] };
    r.leaves.push(it);
    rows.set(it.employee.id, r);
  }
  const todayIso = isoDate(today);

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Team leave calendar"
        description={`${MONTHS[month - 1]} ${year} · ${rows.size} people with leave`}
        breadcrumb={[{ label: "Leave", href: "/leave" }, { label: "Calendar" }]}
        actions={<CalendarNav year={year} month={month} departments={departments} departmentId={departmentId} />}
      />
      <div className="flex gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="size-3 rounded-sm bg-primary" /> Approved</span>
        <span className="inline-flex items-center gap-1"><span className="size-3 rounded-sm border-2 border-dashed border-primary" /> Pending</span>
        <span className="inline-flex items-center gap-1"><span className="size-3 rounded-sm bg-muted" /> Weekend</span>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[900px] border-collapse text-xs">
          <thead>
            <tr className="bg-muted/50">
              <th className="sticky left-0 z-10 w-48 bg-muted/50 px-2 py-2 text-left font-medium">Employee</th>
              {days.map((d) => (
                <th key={isoDate(d)} className={cn("w-7 px-0 py-2 text-center font-normal", [0, 6].includes(d.getUTCDay()) && "bg-muted", isoDate(d) === todayIso && "text-primary")}>{d.getUTCDate()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.size === 0 && (
              <tr><td colSpan={days.length + 1} className="py-10 text-center text-muted-foreground">Nobody in your scope is on leave this month.</td></tr>
            )}
            {[...rows.values()].map(({ employee, leaves }) => (
              <tr key={employee.id} className="border-t">
                <td className="sticky left-0 z-10 bg-background px-2 py-1.5">
                  <Link href={`/attendance/employee/${employee.id}?year=${year}&month=${month}`} className="hover:underline">
                    <span className="block truncate font-medium">{employee.displayName}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{employee.department?.name ?? employee.employeeCode}</span>
                  </Link>
                </td>
                {days.map((d) => {
                  const iso = isoDate(d);
                  const l = leaves.find((x) => x.startDate <= iso && x.endDate >= iso);
                  const weekend = [0, 6].includes(d.getUTCDay());
                  const half = l && ((l.startDate === iso && l.startHalf) || (l.endDate === iso && l.endHalf));
                  return (
                    <td key={iso} className={cn("h-8 px-px", weekend && "bg-muted")} title={l ? `${l.leaveType.name} (${l.status.toLowerCase()})${half ? " · half day" : ""}` : undefined}>
                      {l && (
                        <div
                          className={cn("mx-auto h-5 w-full rounded-sm", l.status === "PENDING" ? "border-2 border-dashed" : "", half && "opacity-50")}
                          style={l.status === "PENDING" ? { borderColor: l.leaveType.color } : { background: l.leaveType.color }}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
