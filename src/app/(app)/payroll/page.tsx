import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { PageHeader, EmptyState, StatCard, StatusBadge } from "@/components/common";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtMoney } from "@/lib/dates";
import { listRuns, listLegalEntities, monthLabel } from "@/server/services/payroll";
import { NewRunDialog } from "@/components/payroll/new-run-dialog";
import { Pager } from "@/components/payroll/pager";
import { RunFilters } from "@/components/payroll/run-filters";

export const metadata = { title: "Payroll runs" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const STATUSES = ["DRAFT", "PROCESSING", "REVIEW", "FINALIZED", "PAID"] as const;

export default async function PayrollRunsPage({ searchParams }: PageProps<"/payroll">) {
  const actor = await requireActor();
  const sp = await searchParams;
  const year = Number(str(sp.year)) || undefined;
  const status = STATUSES.find((s) => s === str(sp.status));
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  if (!can(actor, "payroll:run") && !can(actor, "payroll:read", "ALL")) {
    return (
      <div>
        <PageHeader title="Payroll runs" />
        <EmptyState title="No access" description="Payroll runs are visible to payroll administrators and finance." />
      </div>
    );
  }
  const [runs, entities] = await Promise.all([listRuns(actor, { page, pageSize: 25, order: "desc", year, status }), listLegalEntities(actor)]);
  const now = new Date();
  const latest = runs.items[0];

  return (
    <div>
      <PageHeader
        title="Payroll runs"
        description="Create a monthly run per legal entity, process it, review the register, then finalise and pay."
        actions={can(actor, "payroll:run") && <NewRunDialog entities={entities.map((e) => ({ id: e.id, name: e.name }))} defaultMonth={now.getUTCMonth() + 1} defaultYear={now.getUTCFullYear()} />}
      />
      {latest && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Latest run" value={`${monthLabel(latest.month).slice(0, 3)} ${latest.year}`} hint={<StatusBadge status={latest.status} />} />
          <StatCard label="Employees" value={latest.employeeCount.toLocaleString("en-IN")} hint={`${latest.processedCount.toLocaleString("en-IN")} processed`} />
          <StatCard label="Gross" value={fmtMoney(latest.totalGross)} hint={`Employer cost ${fmtMoney(latest.totalEmployerCost)}`} />
          <StatCard label="Net pay" value={fmtMoney(latest.totalNet)} hint={`Deductions ${fmtMoney(latest.totalDeductions)}`} />
        </div>
      )}
      <RunFilters year={year} status={status} />
      {runs.items.length === 0 ? (
        <EmptyState title="No payroll runs yet" description="Create a run for the current month to get started." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Employees</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Deductions</TableHead>
                <TableHead className="text-right">Net pay</TableHead>
                <TableHead className="text-right">Employer cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/payroll/runs/${r.id}`} className="font-medium hover:underline">
                      {monthLabel(r.month)} {r.year}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.legalEntityName}</TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                  <TableCell className="text-right tabular-nums">{r.processedCount.toLocaleString("en-IN")} / {r.employeeCount.toLocaleString("en-IN")}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(r.totalGross)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(r.totalDeductions)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{fmtMoney(r.totalNet)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(r.totalEmployerCost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pager page={runs.page} pages={runs.pages} total={runs.total} basePath="/payroll" params={{ year: year ? String(year) : undefined, status }} />
    </div>
  );
}
