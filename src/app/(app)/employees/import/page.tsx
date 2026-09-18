import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader } from "@/components/common";
import { ImportCsv } from "@/components/employees/import-csv";

export const metadata = { title: "Import employees" };

export default async function ImportPage() {
  const actor = await requireActor();
  if (!can(actor, "employees:import", "ALL")) return <EmptyState title="Not allowed" description="You need the Bulk import employees permission." />;
  return (
    <div>
      <PageHeader title="Import employees" description="Upload a CSV, review validation results, then import." breadcrumb={[{ label: "Directory", href: "/employees" }, { label: "Import" }]} />
      <ImportCsv />
    </div>
  );
}
