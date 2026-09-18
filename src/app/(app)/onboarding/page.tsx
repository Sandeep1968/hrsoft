import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader, StatCard } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OnboardingTaskList } from "@/components/employees/onboarding-tab";
import { fmtDate } from "@/lib/dates";
import { listMyOnboardingTasks, listOnboardingOverview } from "@/server/services/onboarding";

export const metadata = { title: "Onboarding" };

export default async function OnboardingPage() {
  const actor = await requireActor();
  const canRead = can(actor, "onboarding:read");
  const [overview, mine] = await Promise.all([canRead ? listOnboardingOverview(actor) : Promise.resolve([]), listMyOnboardingTasks(actor)]);
  const overdue = overview.reduce((s, r) => s + r.overdue, 0);
  const pendingTasks = overview.reduce((s, r) => s + (r.total - r.completed), 0);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Onboarding"
        description="New joiners and their checklist progress."
        actions={can(actor, "onboarding:manage") && <Button variant="outline" nativeButton={false} render={<Link href="/onboarding/templates" />}>Templates</Button>}
      />
      {mine.team.length > 0 && <OnboardingTaskList tasks={mine.team} title="Tasks for your new reports" showEmployee />}
      {mine.mine.length > 0 && <OnboardingTaskList tasks={mine.mine} title="Your onboarding tasks" />}
      {canRead && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Onboarding" value={overview.length} hint="employees in progress" />
            <StatCard label="Open tasks" value={pendingTasks} />
            <StatCard label="Overdue tasks" value={overdue} />
          </div>
          {overview.length === 0 ? (
            <EmptyState title="No one is onboarding right now" description="New employees appear here until every checklist task is done." />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Joining</TableHead><TableHead>Department</TableHead><TableHead>Manager</TableHead><TableHead>Progress</TableHead></TableRow></TableHeader>
                <TableBody>
                  {overview.map((r) => {
                    const pct = r.total ? Math.round((r.completed / r.total) * 100) : 0;
                    return (
                      <TableRow key={r.id}>
                        <TableCell><Link href={`/employees/${r.id}?tab=onboarding`} className="font-medium hover:underline">{r.displayName}</Link><div className="text-xs text-muted-foreground">{r.employeeCode} · {r.designation ?? "—"}</div></TableCell>
                        <TableCell>{fmtDate(r.joiningDate)}</TableCell>
                        <TableCell>{r.department ?? "—"}</TableCell>
                        <TableCell>{r.manager ?? "—"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2"><Progress value={pct} className="w-32" /><span className="text-xs text-muted-foreground">{r.completed}/{r.total}{r.overdue ? <span className="ml-1 text-destructive">· {r.overdue} overdue</span> : null}</span></div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
