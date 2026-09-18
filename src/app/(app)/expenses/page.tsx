import Link from "next/link";
import { Plus } from "lucide-react";
import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { PageHeader, EmptyState, StatusBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtMoney } from "@/lib/dates";
import { listClaims, type ClaimDto } from "@/server/services/expenses";
import { ClaimFilters } from "@/components/expenses/claim-filters";
import { Pager } from "@/components/payroll/pager";

export const metadata = { title: "Expenses" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "REIMBURSED"] as const;

export default async function ExpensesPage({ searchParams }: PageProps<"/expenses">) {
  const actor = await requireActor();
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === str(sp.status));
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const canApprove = can(actor, "expenses:approve");
  const canSeeAll = can(actor, "expenses:read", "TEAM");
  const requested = str(sp.view);
  const view = requested === "approve" && canApprove ? "approve" : requested === "all" && canSeeAll ? "all" : "mine";
  if (!can(actor, "expenses:read")) {
    return (
      <div>
        <PageHeader title="Expenses" />
        <EmptyState title="No access" description="Expense claims require the expenses:read permission." />
      </div>
    );
  }
  const claims = actor.employeeId || view !== "mine" ? await listClaims(actor, { page, pageSize: 25, order: "desc", status, view }) : { items: [] as ClaimDto[], total: 0, page: 1, pageSize: 25, pages: 1 };
  const queue = canApprove && view === "mine" ? await listClaims(actor, { page: 1, pageSize: 1, order: "desc", view: "approve" }) : null;

  return (
    <div>
      <PageHeader
        title="Expenses"
        description="Claim business expenses, track approvals and reimbursements."
        actions={actor.employeeId && can(actor, "expenses:submit") && <Button nativeButton={false} render={<Link href="/expenses/new" />}><Plus /> New claim</Button>}
      />
      <ClaimFilters status={status} view={view} showApprove={canApprove} showAll={canSeeAll} pendingApprovals={queue?.total ?? 0} />
      {!actor.employeeId && view === "mine" ? (
        <EmptyState title="No employee profile" description="Switch to the team view to see claims." />
      ) : claims.items.length === 0 ? (
        <EmptyState title={view === "approve" ? "Nothing awaiting your approval" : "No expense claims"} description={view === "mine" ? "Create a claim to get reimbursed for business expenses." : undefined} action={view === "mine" && actor.employeeId ? <Button nativeButton={false} render={<Link href="/expenses/new" />}>New claim</Button> : undefined} />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Claim</TableHead>
                {view !== "mine" && <TableHead>Employee</TableHead>}
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Approver</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {claims.items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell><Link href={`/expenses/${c.id}`} className="font-medium hover:underline">{c.title}</Link><div className="text-xs text-muted-foreground">Created {fmtDate(c.createdAt)}</div></TableCell>
                  {view !== "mine" && <TableCell>{c.displayName}<div className="text-xs text-muted-foreground">{c.department ?? ""}</div></TableCell>}
                  <TableCell className="text-right tabular-nums">{c.itemCount}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{fmtMoney(c.totalAmount, c.currency)}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(c.submittedAt)}</TableCell>
                  <TableCell className="text-muted-foreground">{c.approverName ?? "—"}</TableCell>
                  <TableCell><StatusBadge status={c.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pager page={claims.page} pages={claims.pages} total={claims.total} basePath="/expenses" params={{ status, view }} />
    </div>
  );
}
