import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { db } from "@/lib/db";
import { EmptyState, PageHeader, StatCard } from "@/components/common";
import { NativeSelect } from "@/components/common/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pager } from "@/components/psa/pager";
import { listTicketCategories, listTickets, listTicketsSchema, slaReport } from "@/server/services/helpdesk";
import { TicketTable } from "../ticket-table";
import { CategoriesPanel } from "./categories-panel";
import { SlaCharts } from "./sla-charts";

export const metadata = { title: "Helpdesk admin" };
const STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_ON_EMPLOYEE", "RESOLVED", "CLOSED"];

export default async function HelpdeskAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const manage = can(actor, "helpdesk:manage");
  if (!manage && !can(actor, "helpdesk:agent")) return <div><PageHeader title="Helpdesk admin" /><EmptyState title="Agents only" description="You need helpdesk:agent or helpdesk:manage to work the queue." /></div>;

  const view = sp.view === "mine" ? "mine" : sp.view === "all" ? "all" : sp.view === "sla" ? "sla" : sp.view === "categories" ? "categories" : "unassigned";
  const status = STATUSES.includes(String(sp.status)) ? String(sp.status) : undefined;
  const [categories, roleKeys] = await Promise.all([listTicketCategories(actor), manage ? db.role.findMany({ select: { key: true }, orderBy: { key: "asc" } }).then((r) => r.map((x) => x.key)) : []]);

  const q = listTicketsSchema.parse({
    page: sp.page ?? "1",
    pageSize: "25",
    order: "desc",
    status,
    statusGroup: status ? undefined : sp.closed === "1" ? "closed" : "open",
    unassigned: view === "unassigned" ? "true" : undefined,
    assignedToMe: view === "mine" ? "true" : undefined,
    categoryId: typeof sp.categoryId === "string" && sp.categoryId ? sp.categoryId : undefined,
    priority: ["LOW", "MEDIUM", "HIGH", "URGENT"].includes(String(sp.priority)) ? sp.priority : undefined,
    overdue: sp.overdue === "1" ? "true" : undefined,
    q: typeof sp.q === "string" && sp.q ? sp.q : undefined,
  });
  const [page, sla] = await Promise.all([view === "sla" || view === "categories" ? null : listTickets(actor, q), manage ? slaReport(actor) : null]);

  const tabs: [string, string][] = [["unassigned", "Unassigned"], ["mine", "Mine"], ["all", manage ? "All" : "My queue"], ...(manage ? ([["sla", "SLA dashboard"], ["categories", "Categories"]] as [string, string][]) : [])];
  const tabHref = (v: string) => `/helpdesk/admin?${new URLSearchParams({ view: v }).toString()}`;

  return (
    <div>
      <PageHeader title="Helpdesk admin" description={manage ? "Queue, SLA health and category routing." : "Tickets assigned to you and unassigned tickets in your categories."} actions={<Button variant="outline" nativeButton={false} render={<Link href="/helpdesk" />}>My tickets</Button>} />
      {sla && (
        <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Open" value={sla.openCount} hint={`${sla.byStatus.OPEN ?? 0} new · ${sla.byStatus.IN_PROGRESS ?? 0} in progress · ${sla.byStatus.WAITING_ON_EMPLOYEE ?? 0} waiting`} />
          <StatCard label="Overdue" value={sla.overdueCount} hint="past SLA due time" />
          <StatCard label="Resolved" value={sla.byStatus.RESOLVED ?? 0} hint={`${sla.byStatus.CLOSED ?? 0} closed`} />
          <StatCard label="Within SLA" value={(() => { const r = sla.resolution.filter((x) => x.resolved > 0); const tot = r.reduce((a, b) => a + b.resolved, 0); const ok = r.reduce((a, b) => a + b.withinSla, 0); return tot ? `${Math.round((ok / tot) * 100)}%` : "—"; })()} hint="of resolved tickets" />
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-muted p-0.5 text-sm">
        {tabs.map(([v, label]) => <Link key={v} href={tabHref(v)} className={`rounded-md px-3 py-1 ${view === v ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{label}</Link>)}
      </div>

      {page && (
        <>
          <form method="get" className="mb-3 flex flex-wrap items-center gap-2">
            <input type="hidden" name="view" value={view} />
            <Input name="q" placeholder="Subject or #" defaultValue={typeof sp.q === "string" ? sp.q : ""} className="w-48" />
            <NativeSelect name="status" defaultValue={status ?? ""} className="w-44"><option value="">Open statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</NativeSelect>
            <NativeSelect name="categoryId" defaultValue={typeof sp.categoryId === "string" ? sp.categoryId : ""} className="w-44"><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
            <NativeSelect name="priority" defaultValue={typeof sp.priority === "string" ? sp.priority : ""} className="w-32"><option value="">Any priority</option>{["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => <option key={p} value={p}>{p}</option>)}</NativeSelect>
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="overdue" value="1" defaultChecked={sp.overdue === "1"} /> Overdue</label>
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="closed" value="1" defaultChecked={sp.closed === "1"} /> Include closed</label>
            <Button type="submit" variant="outline" size="sm">Filter</Button>
          </form>
          <div className="rounded-lg border"><TicketTable items={page.items} showRaiser showAssignee /></div>
          <Pager page={page.page} pages={page.pages} total={page.total} basePath="/helpdesk/admin" params={sp} />
        </>
      )}

      {view === "sla" && sla && (
        <div className="grid gap-4">
          <Card><CardHeader><CardTitle>Resolution & volume</CardTitle></CardHeader><CardContent><SlaCharts resolution={sla.resolution} volume={sla.volumeByCategory} /></CardContent></Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>By category</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Category</TableHead><TableHead className="text-right">Resolved</TableHead><TableHead className="text-right">Avg hours</TableHead><TableHead className="text-right">Within SLA</TableHead></TableRow></TableHeader>
                  <TableBody>{sla.resolution.map((r) => <TableRow key={r.categoryId}><TableCell>{r.category}</TableCell><TableCell className="text-right tabular-nums">{r.resolved}</TableCell><TableCell className="text-right tabular-nums">{r.avgHours ?? "—"}</TableCell><TableCell className="text-right tabular-nums">{r.slaPct === null ? "—" : `${r.slaPct}%`}</TableCell></TableRow>)}</TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Open load by agent</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Agent</TableHead><TableHead className="text-right">Open</TableHead></TableRow></TableHeader>
                  <TableBody>{sla.openByAssignee.map((r) => <TableRow key={r.assigneeId ?? "none"}><TableCell>{r.name}</TableCell><TableCell className="text-right tabular-nums">{r.open}</TableCell></TableRow>)}</TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader><CardTitle>Overdue tickets</CardTitle></CardHeader>
            <CardContent><TicketTable items={sla.overdue} showRaiser showAssignee /></CardContent>
          </Card>
        </div>
      )}

      {view === "categories" && manage && (
        <Card><CardHeader><CardTitle>Categories</CardTitle></CardHeader><CardContent><CategoriesPanel categories={categories} roleKeys={roleKeys} /></CardContent></Card>
      )}
    </div>
  );
}
