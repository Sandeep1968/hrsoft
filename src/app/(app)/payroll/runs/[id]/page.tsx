import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { PageHeader } from "@/components/common";
import { getRun, listAdjustments, listRunPayslips, monthLabel } from "@/server/services/payroll";
import { RunDetail } from "@/components/payroll/run-detail";

export const metadata = { title: "Payroll run" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function PayrollRunPage({ params, searchParams }: PageProps<"/payroll/runs/[id]">) {
  const actor = await requireActor();
  const { id } = await params;
  const sp = await searchParams;
  const q = str(sp.q) || undefined;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const tab = str(sp.tab) || "payslips";
  const run = await getRun(actor, id);
  const [payslips, adjustments] = await Promise.all([
    listRunPayslips(actor, id, { page, pageSize: 25, q, order: "asc" }),
    listAdjustments(actor, { page: 1, pageSize: 200, order: "desc", month: run.month, year: run.year, runId: id }),
  ]);
  return (
    <div>
      <PageHeader
        title={`${monthLabel(run.month)} ${run.year}`}
        description={run.legalEntityName ?? undefined}
        breadcrumb={[{ label: "Payroll", href: "/payroll" }, { label: `${monthLabel(run.month).slice(0, 3)} ${run.year}` }]}
      />
      <RunDetail
        run={run}
        payslips={payslips}
        adjustments={adjustments.items}
        query={{ q: q ?? "", page, tab }}
        perms={{ run: can(actor, "payroll:run"), finalize: can(actor, "payroll:finalize"), sensitive: can(actor, "employees:read_sensitive", "ALL") }}
      />
    </div>
  );
}
