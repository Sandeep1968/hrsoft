import { notFound } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/dates";
import { DL, PageHeader, StatusBadge } from "@/components/common";
import { getTicket } from "@/server/services/helpdesk";
import { TicketThread } from "./ticket-thread";

export const metadata = { title: "Ticket" };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  let t;
  try {
    t = await getTicket(actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`#${t.number} · ${t.subject}`}
        breadcrumb={[{ label: "Helpdesk", href: t.viewerIsAgent && !t.viewerIsRaiser ? "/helpdesk/admin" : "/helpdesk" }, { label: `#${t.number}` }]}
        actions={<><StatusBadge status={t.status} className="text-sm" />{t.isOverdue && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-100">Overdue</span>}</>}
      />
      <div className="mb-4 rounded-lg border p-3">
        <DL items={[
          { label: "Raised by", value: `${t.raiser.displayName}${t.raiser.department ? ` · ${t.raiser.department.name}` : ""}` },
          { label: "Category", value: `${t.category.name} · ${t.category.slaHours}h SLA` },
          { label: "Priority", value: t.priority },
          { label: "Assignee", value: t.assignee?.displayName ?? "Unassigned" },
          { label: "Due", value: fmtDateTime(t.dueAt) },
          { label: "Resolved", value: fmtDateTime(t.resolvedAt) },
        ]} />
      </div>
      <TicketThread ticket={t} />
    </div>
  );
}
