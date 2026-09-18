import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/errors";
import { addDays, fmtDate, fmtMoney, isoDate, todayUtc } from "@/lib/dates";
import { DL, PageHeader, StatCard, StatusBadge } from "@/components/common";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getProject, projectUtilisation } from "@/server/services/projects";
import { ProjectDialog } from "../project-dialog";
import { MembersPanel } from "./members-panel";
import { TasksPanel } from "./tasks-panel";
import { ProjectCharts } from "./project-charts";
import { can } from "@/lib/rbac/authorize";

export const metadata = { title: "Project" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  let project;
  try {
    project = await getProject(actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const to = todayUtc();
  const from = addDays(to, -27);
  const util = await projectUtilisation(actor, { from, to, projectId: id }).catch(() => null);
  const h = project.hours;

  return (
    <div>
      <PageHeader
        title={project.name}
        description={`${project.code}${project.client ? ` · ${project.client.name}` : " · Internal"}${project.manager ? ` · PM ${project.manager.displayName}` : ""}`}
        breadcrumb={[{ label: "Projects", href: "/projects" }, { label: project.code }]}
        actions={
          <>
            <StatusBadge status={project.status} className="text-sm" />
            {project.canManage && <ProjectDialog trigger="icon" canPickManager={can(actor, "projects:manage", "ALL")} initial={{ id: project.id, code: project.code, name: project.name, description: project.description, clientId: project.client?.id ?? null, manager: project.manager ? { id: project.manager.id, displayName: project.manager.displayName } : null, startDate: project.startDate, endDate: project.endDate, status: project.status, isBillable: project.isBillable, budgetHours: project.budgetHours, hourlyRate: project.hourlyRate }} />}
            <Button variant="outline" nativeButton={false} render={<Link href={`/timesheets`} />}>My timesheet</Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Hours logged" value={`${h.total}h`} hint={h.budget ? `${h.budgetUsedPct}% of ${h.budget}h budget` : "No budget set"} />
        <StatCard label="Billable" value={`${h.billable}h`} hint={`${h.nonBillable}h non-billable · ${h.approved}h approved`} />
        <StatCard label="Billed value" value={h.billedValue === null ? "—" : fmtMoney(h.billedValue)} hint={project.hourlyRate ? `${fmtMoney(project.hourlyRate)}/h × billable hours` : "Set an hourly rate to estimate"} />
        <StatCard label="Team" value={project.members.length} hint={`${project.tasks.length} task${project.tasks.length === 1 ? "" : "s"}${project.otherContributors.length ? ` · ${project.otherContributors.length} past contributor(s)` : ""}`} />
      </div>

      {h.budget ? (
        <div className="mt-4 rounded-lg border p-3">
          <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>Budget consumption</span><span>{h.total}h / {h.budget}h</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={h.total > h.budget ? "h-full bg-red-500" : "h-full bg-primary"} style={{ width: `${Math.min(100, h.budgetUsedPct ?? 0)}%` }} /></div>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Members</CardTitle></CardHeader>
          <CardContent><MembersPanel projectId={project.id} members={project.members} canManage={project.canManage} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent>
            <DL items={[
              { label: "Client", value: project.client?.name ?? "Internal" },
              { label: "Contact", value: project.client?.contactEmail ?? project.client?.contactName ?? "—" },
              { label: "Start", value: fmtDate(project.startDate) },
              { label: "End", value: fmtDate(project.endDate) },
              { label: "Billing", value: project.isBillable ? "Billable" : "Non-billable" },
              { label: "Hourly rate", value: project.hourlyRate ? fmtMoney(project.hourlyRate) : "—" },
              { label: "Created", value: fmtDate(project.createdAt) },
            ]} />
            {project.description && <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{project.description}</p>}
          </CardContent>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader><CardTitle>Tasks</CardTitle></CardHeader>
          <CardContent><TasksPanel projectId={project.id} tasks={project.tasks} canManage={project.canManage} /></CardContent>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader><CardTitle>Hours</CardTitle></CardHeader>
          <CardContent>
            <ProjectCharts
              byMember={[...project.members.map((m) => ({ name: m.displayName, hours: m.hours, billable: m.billableHours })), ...project.otherContributors.map((m) => ({ name: `${m.displayName} (past)`, hours: m.hours, billable: m.billableHours }))].filter((m) => m.hours > 0)}
              byTask={[...project.tasks.map((t) => ({ name: t.name, hours: t.hours })), ...(project.unassignedTaskHours > 0 ? [{ name: "No task", hours: project.unassignedTaskHours }] : [])].filter((t) => t.hours > 0)}
              billable={h.billable}
              nonBillable={h.nonBillable}
            />
          </CardContent>
        </Card>
        {util && (
          <Card className="lg:col-span-3">
            <CardHeader><CardTitle>Utilisation · last 4 weeks ({isoDate(from)} → {isoDate(to)})</CardTitle></CardHeader>
            <CardContent>
              {util.byEmployee.length === 0 ? <p className="text-sm text-muted-foreground">No time logged in this window.</p> : (
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {util.byEmployee.map((e) => (
                    <li key={e.employeeId} className="rounded-lg border p-3 text-sm">
                      <div className="flex justify-between"><span className="font-medium">{e.displayName}</span><span className="tabular-nums">{e.hours}h</span></div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.min(100, e.utilisationPct ?? 0)}%` }} /></div>
                      <div className="mt-1 text-xs text-muted-foreground">{e.utilisationPct ?? 0}% of {util.capacityHoursPerPerson}h capacity · {e.billable}h billable</div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
