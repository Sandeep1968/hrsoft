import { requireActor } from "@/lib/auth/session";
import { PageHeader, EmptyState, StatCard } from "@/components/common";
import { can } from "@/lib/rbac/authorize";
import { financialYear, todayUtc } from "@/lib/dates";
import { listDeclarations } from "@/server/services/payroll";
import { DeclarationQueue } from "@/components/payroll/declaration-queue";
import { Pager } from "@/components/payroll/pager";

export const metadata = { title: "Tax proofs" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const STATUSES = ["DRAFT", "SUBMITTED", "VERIFIED", "REJECTED"] as const;

export default async function TaxVerifyPage({ searchParams }: PageProps<"/payroll/tax">) {
  const actor = await requireActor();
  const sp = await searchParams;
  const fy = /^\d{4}-\d{2}$/.test(str(sp.fy)) ? str(sp.fy) : financialYear(todayUtc());
  const status = STATUSES.find((s) => s === str(sp.status)) ?? (str(sp.status) === "ALL" ? undefined : "SUBMITTED");
  const q = str(sp.q) || undefined;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  if (!can(actor, "tax:verify")) {
    return (
      <div>
        <PageHeader title="Tax proofs" />
        <EmptyState title="No access" description="Verifying declarations requires the tax:verify permission." />
      </div>
    );
  }
  const [list, counts] = await Promise.all([
    listDeclarations(actor, { page, pageSize: 25, order: "asc", fy, status, q }),
    Promise.all(STATUSES.map(async (s) => [s, (await listDeclarations(actor, { page: 1, pageSize: 1, order: "asc", fy, status: s })).total] as const)),
  ]);
  const y = Number(fy.slice(0, 4));
  const fys = [y + 1, y, y - 1].map((n) => `${n}-${String(n + 1).slice(-2)}`);
  return (
    <div>
      <PageHeader title="Tax proofs" description="Verify employees' investment declarations for the financial year." />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        {counts.map(([s, n]) => <StatCard key={s} label={s.charAt(0) + s.slice(1).toLowerCase()} value={n.toLocaleString("en-IN")} />)}
      </div>
      <DeclarationQueue items={list.items} fy={fy} fys={fys} status={status ?? "ALL"} q={q ?? ""} />
      {list.items.length === 0 && <EmptyState title="Nothing to verify" description="Declarations matching the filter will appear here." />}
      <Pager page={list.page} pages={list.pages} total={list.total} basePath="/payroll/tax" params={{ fy, status: status ?? "ALL", q }} />
    </div>
  );
}
