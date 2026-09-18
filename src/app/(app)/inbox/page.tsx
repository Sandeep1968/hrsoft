import { requireActor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PageHeader, EmptyState } from "@/components/common";
import { InboxList } from "./inbox-list";

export const metadata = { title: "Inbox" };

export default async function InboxPage() {
  const actor = await requireActor();
  const items = await db.notification.findMany({ where: { userId: actor.userId }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Inbox" description="Approvals, reminders and updates addressed to you." />
      {items.length === 0 ? <EmptyState title="You're all caught up" description="Notifications about approvals, payslips and requests will appear here." /> : <InboxList items={items.map((i) => ({ ...i, createdAt: i.createdAt.toISOString(), readAt: i.readAt?.toISOString() ?? null }))} />}
    </div>
  );
}
