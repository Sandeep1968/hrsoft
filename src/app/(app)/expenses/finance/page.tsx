import { requireActor } from "@/lib/auth/session";
import { PageHeader, StatCard, EmptyState } from "@/components/common";
import { can } from "@/lib/rbac/authorize";
import { fmtMoney } from "@/lib/dates";
import { expenseSummary, listClaims } from "@/server/services/expenses";
import { FinanceView } from "@/components/expenses/finance-view";
import { Pager } from "@/components/payroll/pager";

export const metadata = { title: "Reimbursements" };

export default async function ExpensesFinancePage({ searchParams }: PageProps<"/expenses/finance">) {
  const actor = await requireActor();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  if (!can(actor, "expenses:reimburse") && !can(actor, "expenses:read", "ALL")) {
    return (
      <div>
        <PageHeader title="Reimbursements" />
        <EmptyState title="No access" description="This view is for finance and payroll administrators." />
      </div>
    );
  }
  const [summary, approved] = await Promise.all([expenseSummary(actor), listClaims(actor, { page, pageSize: 25, order: "desc", status: "APPROVED", view: "all" })]);
  return (
    <div>
      <PageHeader title="Reimbursements" description="Approved claims awaiting payment, and spend by category and month." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Awaiting approval" value={fmtMoney(summary.awaitingApproval.amount)} hint={`${summary.awaitingApproval.count} claims`} />
        <StatCard label="Awaiting reimbursement" value={fmtMoney(summary.awaitingReimbursement.amount)} hint={`${summary.awaitingReimbursement.count} claims`} />
        <StatCard label="Approved (12 months)" value={fmtMoney(summary.byCategory.reduce((a, c) => a + c.amount, 0))} hint={`${summary.byCategory.length} categories`} />
        <StatCard label="Top category" value={summary.byCategory[0]?.category ?? "—"} hint={summary.byCategory[0] ? fmtMoney(summary.byCategory[0].amount) : undefined} />
      </div>
      <FinanceView approved={approved.items} summary={summary} />
      <Pager page={approved.page} pages={approved.pages} total={approved.total} basePath="/expenses/finance" />
    </div>
  );
}
