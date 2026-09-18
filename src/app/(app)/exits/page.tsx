import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader, StatCard } from "@/components/common";
import { listExits } from "@/server/services/exits";
import { ExitsTable } from "./exits-table";

export const metadata = { title: "Exits" };

export default async function ExitsPage({ searchParams }: PageProps<"/exits">) {
  const actor = await requireActor();
  const sp = await searchParams;
  const statuses = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
  const status = statuses.find((s) => s === sp.status);
  const manage = can(actor, "exits:manage");
  if (!manage && !actor.employeeId) return <EmptyState title="No exit requests" />;
  const page = await listExits(actor, { status, page: Math.max(1, Number(sp.page ?? 1) || 1), pageSize: 50 });
  const pending = page.items.filter((e) => e.status === "PENDING").length;
  const onNotice = page.items.filter((e) => e.status === "APPROVED" && !(e.clearance.it && e.clearance.finance && e.clearance.hr && e.clearance.manager)).length;
  return (
    <div className="space-y-6">
      <PageHeader title={manage ? "Exits" : "My resignation"} description={manage ? "Resignations awaiting a decision and exit clearance in progress." : "Status of your resignation request."} />
      {manage && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Awaiting decision" value={pending} />
          <StatCard label="Clearance in progress" value={onNotice} />
          <StatCard label="Total shown" value={page.total} />
        </div>
      )}
      {page.items.length === 0 ? <EmptyState title="No exit requests" description={manage ? "Resignations submitted by employees will appear here." : "Submit a resignation from the Job tab on your profile."} /> : <ExitsTable items={page.items} manage={manage} status={status ?? ""} />}
    </div>
  );
}
