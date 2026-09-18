import { requireActor } from "@/lib/auth/session";
import { PageHeader, EmptyState } from "@/components/common";
import { can } from "@/lib/rbac/authorize";
import { listComponents, listSalaries, listStructures } from "@/server/services/payroll";
import { SetupTabs } from "@/components/payroll/setup-tabs";

export const metadata = { title: "Salary setup" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function PayrollSetupPage({ searchParams }: PageProps<"/payroll/setup">) {
  const actor = await requireActor();
  const sp = await searchParams;
  const tab = str(sp.tab) || "components";
  const q = str(sp.q);
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  if (!can(actor, "payroll:manage")) {
    return (
      <div>
        <PageHeader title="Salary setup" />
        <EmptyState title="No access" description="Salary setup requires the payroll:manage permission." />
      </div>
    );
  }
  const [components, structures, salaries] = await Promise.all([
    listComponents(actor, { includeInactive: true }),
    listStructures(actor),
    listSalaries(actor, { page, pageSize: 25, q: q || undefined, order: "asc" }),
  ]);
  return (
    <div>
      <PageHeader title="Salary setup" description="Components, CTC structures and per-employee salary assignments." />
      <SetupTabs tab={tab} components={components} structures={structures} salaries={salaries} query={{ q, page }} />
    </div>
  );
}
