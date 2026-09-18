import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader } from "@/components/common";
import { CUSTOM_COLUMNS, reportLookups } from "@/server/services/reports";
import { CustomBuilder } from "./custom-builder";

export const metadata = { title: "Custom report" };

export default async function CustomReportPage() {
  const actor = await requireActor();
  if (!can(actor, "reports:view") || !can(actor, "employees:read")) return <div><PageHeader title="Custom report" /><EmptyState title="No access" description="Custom reports require reports:view and employees:read." /></div>;
  const lookups = await reportLookups(actor);
  const columns = Object.entries(CUSTOM_COLUMNS).map(([key, v]) => ({ key, label: v.label, group: v.group }));
  return (
    <div>
      <PageHeader title="Custom employee report" description="Pick columns and filters; results are limited to employees you can report on." breadcrumb={[{ label: "Reports", href: "/reports" }, { label: "Custom" }]} />
      <CustomBuilder columns={columns} lookups={lookups} canExport={can(actor, "reports:export")} />
    </div>
  );
}
