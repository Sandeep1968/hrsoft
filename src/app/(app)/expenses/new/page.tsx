import { requireActor } from "@/lib/auth/session";
import { PageHeader, EmptyState } from "@/components/common";
import { listCategories } from "@/server/services/expenses";
import { ClaimForm } from "@/components/expenses/claim-form";

export const metadata = { title: "New expense claim" };

export default async function NewExpensePage() {
  const actor = await requireActor();
  const categories = await listCategories(actor);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New expense claim" breadcrumb={[{ label: "Expenses", href: "/expenses" }, { label: "New claim" }]} />
      {!actor.employeeId ? <EmptyState title="No employee profile" description="Only employees can submit expense claims." /> : <ClaimForm categories={categories} />}
    </div>
  );
}
