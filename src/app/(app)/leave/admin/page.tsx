import { requireActor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader } from "@/components/common";
import { leaveListSchema, listLeaveRequests, listLeaveTypes } from "@/server/services/leave";
import { todayIst } from "@/server/services/calendar";
import { LeaveAdminTabs } from "./admin-tabs";

export const metadata = { title: "Leave admin" };

export default async function LeaveAdminPage({ searchParams }: PageProps<"/leave/admin">) {
  const actor = await requireActor();
  if (!can(actor, "leave:manage")) {
    return (
      <div>
        <PageHeader title="Leave admin" breadcrumb={[{ label: "Leave", href: "/leave" }, { label: "Admin" }]} />
        <EmptyState title="Not permitted" description="You need the leave:manage permission to open this page." />
      </div>
    );
  }
  const sp = await searchParams;
  const parsed = leaveListSchema.safeParse({ ...sp, pageSize: 50, order: "desc" });
  const params = parsed.success ? parsed.data : { page: 1, pageSize: 50, order: "desc" as const };
  const [types, departments, requests] = await Promise.all([
    listLeaveTypes(actor, { includeInactive: true }),
    db.department.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    listLeaveRequests(actor, params),
  ]);
  return (
    <div>
      <PageHeader title="Leave admin" description="Leave types, balances, the request queue and year-end processing." breadcrumb={[{ label: "Leave", href: "/leave" }, { label: "Admin" }]} />
      <LeaveAdminTabs
        types={types}
        departments={departments}
        requests={{ items: requests.items, total: requests.total, page: requests.page, pages: requests.pages }}
        requestFilters={{ status: typeof sp.status === "string" ? sp.status : undefined, departmentId: typeof sp.departmentId === "string" ? sp.departmentId : undefined, q: typeof sp.q === "string" ? sp.q : undefined }}
        defaultTab={typeof sp.tab === "string" ? sp.tab : undefined}
        year={todayIst().getUTCFullYear()}
      />
    </div>
  );
}
