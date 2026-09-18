import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { PageHeader } from "@/components/common";
import { Directory } from "@/components/employees/directory";
import { listEmployees } from "@/server/services/employees";
import { getOrgLookups } from "@/server/services/org";

export const metadata = { title: "Directory" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

export default async function EmployeesPage({ searchParams }: PageProps<"/employees">) {
  const actor = await requireActor();
  const sp = await searchParams;
  const params = { q: str(sp.q), departmentId: isUuid(str(sp.departmentId)) ? str(sp.departmentId) : "", locationId: isUuid(str(sp.locationId)) ? str(sp.locationId) : "", status: str(sp.status), page: Math.max(1, Number(sp.page ?? 1) || 1) };
  const statuses = ["ONBOARDING", "ACTIVE", "ON_NOTICE", "EXITED"] as const;
  const status = statuses.find((s) => s === params.status);
  const [page, lookups] = await Promise.all([
    listEmployees(actor, { page: params.page, pageSize: 25, q: params.q || undefined, departmentId: params.departmentId || undefined, locationId: params.locationId || undefined, status }),
    getOrgLookups(actor),
  ]);
  return (
    <div>
      <PageHeader title="Directory" description="Everyone in the organisation." />
      <Directory page={page} lookups={lookups} params={params} canWrite={can(actor, "employees:write", "ALL")} canImport={can(actor, "employees:import", "ALL")} canExport={can(actor, "reports:export")} />
    </div>
  );
}
