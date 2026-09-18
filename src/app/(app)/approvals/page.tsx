import { requireActor } from "@/lib/auth/session";
import { EmptyState, PageHeader } from "@/components/common";
import { listPendingApprovals } from "@/server/services/approvals";
import { ApprovalsInbox } from "./approvals-inbox";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const actor = await requireActor();
  const data = await listPendingApprovals(actor);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Approvals" description={data.total === 0 ? "Everything in your scope has been decided." : `${data.total} request${data.total === 1 ? "" : "s"} waiting for your decision.`} />
      {data.total === 0 ? <EmptyState title="Inbox zero" description="Leave, regularisation, work-from-home, expense, timesheet and exit requests from your team will show up here." /> : <ApprovalsInbox items={data.items} counts={data.counts} />}
    </div>
  );
}
