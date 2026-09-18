import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { toDateOnly } from "@/lib/dates";
import { EmptyState, PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { getOrCreateWeek } from "@/server/services/timesheets";
import { TimesheetGrid } from "./timesheet-grid";

export const metadata = { title: "Timesheets" };

export default async function TimesheetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const weekParam = typeof sp.weekStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.weekStart) ? toDateOnly(sp.weekStart) : undefined;
  const employeeId = typeof sp.employeeId === "string" && sp.employeeId !== actor.employeeId ? sp.employeeId : undefined;
  const teamLink = (can(actor, "timesheets:approve") || can(actor, "timesheets:read", "TEAM")) && (
    <Button variant="outline" nativeButton={false} render={<Link href="/timesheets/team" />}>Team</Button>
  );

  if (!actor.employeeId && !employeeId) {
    return (
      <div>
        <PageHeader title="Timesheets" actions={teamLink} />
        <EmptyState title="No employee profile" description="Administrator accounts do not fill timesheets. Use the Team view to review submitted sheets." />
      </div>
    );
  }

  const data = await getOrCreateWeek(actor, employeeId, weekParam);
  const viewingOther = !!employeeId;
  return (
    <div>
      <PageHeader
        title={viewingOther ? `Timesheet · ${data.timesheet.employeeName ?? ""}` : "My timesheet"}
        description={viewingOther ? `${data.timesheet.employeeCode ?? ""}${data.timesheet.department ? ` · ${data.timesheet.department}` : ""}` : "Log hours per project and task for each day, save a draft, then submit for approval."}
        actions={teamLink}
      />
      {data.projects.length === 0 && data.timesheet.entries.length === 0 ? (
        <EmptyState title="No projects assigned" description="You need to be a member of at least one active project before logging time. Ask your project manager to add you." />
      ) : (
        <TimesheetGrid sheet={data.timesheet} projects={data.projects} canEdit={data.canEdit} employeeId={employeeId} />
      )}
    </div>
  );
}
