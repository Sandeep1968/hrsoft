import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader, StatusBadge } from "@/components/common";
import { NativeSelect } from "@/components/common/native-select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pager } from "@/components/psa/pager";
import { listProjects, listProjectsSchema } from "@/server/services/projects";
import { ProjectDialog } from "./project-dialog";
import { ClientsDialog } from "./clients-dialog";

export const metadata = { title: "Projects" };

const STATUSES = ["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"];

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const q = listProjectsSchema.parse({ page: sp.page ?? "1", pageSize: "25", q: sp.q || undefined, status: STATUSES.includes(String(sp.status)) ? sp.status : undefined, order: "asc" });
  const page = await listProjects(actor, q);
  const manage = can(actor, "projects:manage");

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Client and internal projects, their teams and hours logged against budget."
        actions={manage && (<><ClientsDialog /><ProjectDialog canPickManager={can(actor, "projects:manage", "ALL")} /></>)}
      />
      <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
        <div className="w-full sm:w-64"><Input name="q" defaultValue={sp.q ? String(sp.q) : ""} placeholder="Search code or name" /></div>
        <div className="w-40">
          <NativeSelect name="status" defaultValue={sp.status ? String(sp.status) : ""}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline">Filter</Button>
        {can(actor, "projects:read") && <Button variant="ghost" nativeButton={false} render={<Link href="/projects/utilisation" />}>Utilisation</Button>}
      </form>

      {page.items.length === 0 ? (
        <EmptyState title="No projects" description={manage ? "Create your first project to start tracking time." : "You are not a member of any project yet."} />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Manager</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-56">Hours vs budget</TableHead>
                <TableHead className="text-right">Team</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.items.map((p) => {
                const pct = p.budgetHours ? Math.min(100, Math.round((p.hoursLogged / p.budgetHours) * 100)) : null;
                const over = p.budgetHours ? p.hoursLogged > p.budgetHours : false;
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                      <div className="text-xs text-muted-foreground">{p.code}{p.isBillable ? " · billable" : " · non-billable"}</div>
                    </TableCell>
                    <TableCell>{p.client?.name ?? <span className="text-muted-foreground">Internal</span>}</TableCell>
                    <TableCell>{p.manager?.displayName ?? "—"}</TableCell>
                    <TableCell><StatusBadge status={p.status} /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className={over ? "h-full bg-red-500" : "h-full bg-primary"} style={{ width: `${pct ?? (p.hoursLogged > 0 ? 100 : 0)}%` }} />
                        </div>
                        <span className="w-24 text-right text-xs tabular-nums text-muted-foreground">{p.hoursLogged}h{p.budgetHours ? ` / ${p.budgetHours}h` : ""}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.memberCount}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Pager page={page.page} pages={page.pages} total={page.total} basePath="/projects" params={sp} />
    </div>
  );
}
