import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader, StatusBadge } from "@/components/common";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate } from "@/lib/dates";
import { listTeamAttendance, teamAttendanceQuerySchema } from "@/server/services/attendance";
import { cn } from "@/lib/utils";
import { fmtMinutes, fmtTime, STATUS_CELL, STATUS_LABEL } from "../format";
import { TeamToolbar } from "./team-toolbar";

export const metadata = { title: "Team attendance" };

export default async function TeamAttendancePage({ searchParams }: PageProps<"/attendance/team">) {
  const actor = await requireActor();
  if (!can(actor, "attendance:read", "TEAM")) {
    return (
      <div>
        <PageHeader title="Team attendance" breadcrumb={[{ label: "Attendance", href: "/attendance" }, { label: "Team" }]} />
        <EmptyState title="No team visibility" description="Team attendance is available to managers and HR." />
      </div>
    );
  }
  const sp = await searchParams;
  const parsed = teamAttendanceQuerySchema.safeParse({ ...sp, pageSize: 50 });
  const params = parsed.success ? parsed.data : { page: 1, pageSize: 50, order: "asc" as const };
  const [data, departments] = await Promise.all([listTeamAttendance(actor, params), db.department.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } })]);
  const dateIso = data.date;
  const qs = (page: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "page") p.set(k, v);
    p.set("page", String(page));
    return `/attendance/team?${p.toString()}`;
  };

  return (
    <div className="grid gap-4">
      <PageHeader title="Team attendance" description={`${fmtDate(dateIso)} · ${data.headcount} people in scope`} breadcrumb={[{ label: "Attendance", href: "/attendance" }, { label: "Team" }]} />
      <TeamToolbar departments={departments} date={dateIso} departmentId={typeof sp.departmentId === "string" ? sp.departmentId : undefined} status={typeof sp.status === "string" ? sp.status : undefined} q={typeof sp.q === "string" ? sp.q : undefined} />
      <div className="flex flex-wrap gap-2">
        {Object.entries(data.summary).map(([k, v]) => (
          <Link key={k} href={qs(1) + `&status=${k}`} className={cn("rounded-full px-2.5 py-1 text-xs font-medium", STATUS_CELL[k] ?? "bg-muted")}>
            {STATUS_LABEL[k] ?? k} <span className="tabular-nums">{v}</span>
          </Link>
        ))}
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Shift</TableHead>
              <TableHead>In</TableHead>
              <TableHead>Out</TableHead>
              <TableHead>Worked</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No employees match these filters.</TableCell>
              </TableRow>
            )}
            {data.items.map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  <Link href={`/attendance/employee/${e.id}?date=${dateIso}`} className="flex items-center gap-2 hover:underline">
                    <Avatar size="sm">
                      {e.photoUrl && <AvatarImage src={e.photoUrl} alt="" />}
                      <AvatarFallback>{e.displayName.slice(0, 1)}</AvatarFallback>
                    </Avatar>
                    <span>
                      <span className="block font-medium">{e.displayName}</span>
                      <span className="block text-xs text-muted-foreground">{e.employeeCode}</span>
                    </span>
                  </Link>
                </TableCell>
                <TableCell>{e.department?.name ?? "—"}</TableCell>
                <TableCell>{e.shift ?? "Default"}</TableCell>
                <TableCell className="tabular-nums">{fmtTime(e.firstIn)}{e.lateMinutes > 0 && <span className="ml-1 text-xs text-amber-700 dark:text-amber-300">+{e.lateMinutes}m</span>}</TableCell>
                <TableCell className="tabular-nums">{fmtTime(e.lastOut)}</TableCell>
                <TableCell className="tabular-nums">{e.workMinutes ? fmtMinutes(e.workMinutes) : "—"}</TableCell>
                <TableCell>{e.status ? <StatusBadge status={e.status} /> : <span className="text-xs text-muted-foreground">No record</span>}{e.isRegularized && <span className="ml-1 text-[10px] uppercase text-muted-foreground">R</span>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {data.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {data.page} of {data.pages} · {data.total} employees</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={data.page <= 1} nativeButton={false} render={<Link href={qs(data.page - 1)} />}>Previous</Button>
            <Button variant="outline" size="sm" disabled={data.page >= data.pages} nativeButton={false} render={<Link href={qs(data.page + 1)} />}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
