import { requireActor } from "@/lib/auth/session";
import { addDays, isoDate, todayUtc, toDateOnly } from "@/lib/dates";
import { PageHeader, StatCard } from "@/components/common";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { projectUtilisation } from "@/server/services/projects";
import { UtilisationChart } from "./utilisation-chart";

export const metadata = { title: "Utilisation" };

export default async function UtilisationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(sp.to)) ? toDateOnly(String(sp.to)) : todayUtc();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(sp.from)) ? toDateOnly(String(sp.from)) : addDays(to, -27);
  const u = await projectUtilisation(actor, { from, to });
  return (
    <div>
      <PageHeader title="Utilisation" description="Hours logged by project and by person for a period, against an 8h/working-day capacity." breadcrumb={[{ label: "Projects", href: "/projects" }, { label: "Utilisation" }]} />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs">From<Input type="date" name="from" defaultValue={isoDate(from)} /></label>
        <label className="grid gap-1 text-xs">To<Input type="date" name="to" defaultValue={isoDate(to)} /></label>
        <Button type="submit" variant="outline">Apply</Button>
      </form>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total hours" value={`${u.totals.hours}h`} hint={`${u.totals.billable}h billable`} />
        <StatCard label="Working days" value={u.workingDays} hint={`${u.capacityHoursPerPerson}h capacity per person`} />
        <StatCard label="People" value={u.byEmployee.length} hint={`${u.byProject.length} project(s) with time`} />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>By project</CardTitle></CardHeader>
          <CardContent>
            <UtilisationChart data={u.byProject.slice(0, 12).map((p) => ({ name: p.code, Billable: p.billable, "Non-billable": p.hours - p.billable }))} />
            <Table>
              <TableHeader><TableRow><TableHead>Project</TableHead><TableHead className="text-right">Hours</TableHead><TableHead className="text-right">Billable</TableHead><TableHead className="text-right">People</TableHead></TableRow></TableHeader>
              <TableBody>{u.byProject.map((p) => <TableRow key={p.projectId}><TableCell>{p.code} <span className="text-muted-foreground">{p.name}</span></TableCell><TableCell className="text-right tabular-nums">{p.hours}</TableCell><TableCell className="text-right tabular-nums">{p.billable}</TableCell><TableCell className="text-right tabular-nums">{p.people}</TableCell></TableRow>)}</TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>By person</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead className="text-right">Hours</TableHead><TableHead className="text-right">Billable</TableHead><TableHead className="w-40">Utilisation</TableHead></TableRow></TableHeader>
              <TableBody>
                {u.byEmployee.length === 0 && <TableRow><TableCell colSpan={4} className="text-muted-foreground">No time logged in this period.</TableCell></TableRow>}
                {u.byEmployee.map((e) => (
                  <TableRow key={e.employeeId}>
                    <TableCell>{e.displayName} <span className="text-xs text-muted-foreground">{e.employeeCode}</span></TableCell>
                    <TableCell className="text-right tabular-nums">{e.hours}</TableCell>
                    <TableCell className="text-right tabular-nums">{e.billable}</TableCell>
                    <TableCell><div className="flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className={(e.utilisationPct ?? 0) > 100 ? "h-full bg-red-500" : "h-full bg-primary"} style={{ width: `${Math.min(100, e.utilisationPct ?? 0)}%` }} /></div><span className="w-10 text-right text-xs tabular-nums">{e.utilisationPct ?? 0}%</span></div></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
