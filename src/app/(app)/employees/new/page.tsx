import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader } from "@/components/common";
import { EmployeeForm } from "@/components/employees/employee-form";
import { getOrgLookups } from "@/server/services/org";

export const metadata = { title: "Add employee" };

export default async function NewEmployeePage() {
  const actor = await requireActor();
  if (!can(actor, "employees:write", "ALL")) return <EmptyState title="Not allowed" description="You need the Create and edit employee records permission." />;
  const lookups = await getOrgLookups(actor);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Add employee" description="Creates the employee record, login, salary, leave balances and onboarding checklist." breadcrumb={[{ label: "Directory", href: "/employees" }, { label: "New" }]} />
      <EmployeeForm lookups={lookups} />
    </div>
  );
}
