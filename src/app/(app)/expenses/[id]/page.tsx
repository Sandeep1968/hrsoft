import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { PageHeader, StatusBadge } from "@/components/common";
import { getClaim } from "@/server/services/expenses";
import { ClaimDetail } from "@/components/expenses/claim-detail";

export const metadata = { title: "Expense claim" };

export default async function ExpenseClaimPage({ params }: PageProps<"/expenses/[id]">) {
  const actor = await requireActor();
  const { id } = await params;
  const claim = await getClaim(actor, id);
  const isOwner = actor.employeeId === claim.employeeId;
  const approveScope = actor.perms.get("expenses:approve");
  const canDecide = claim.status === "SUBMITTED" && Boolean(approveScope) && (approveScope === "ALL" || (!isOwner && (claim.approverId === actor.employeeId || can(actor, "expenses:approve", "TEAM"))));
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={claim.title}
        description={`${claim.displayName} · ${claim.employeeCode}${claim.department ? ` · ${claim.department}` : ""}`}
        breadcrumb={[{ label: "Expenses", href: "/expenses" }, { label: claim.title }]}
        actions={<StatusBadge status={claim.status} className="text-sm" />}
      />
      <ClaimDetail claim={claim} perms={{ owner: isOwner && can(actor, "expenses:submit"), decide: canDecide, reimburse: can(actor, "expenses:reimburse") }} />
    </div>
  );
}
