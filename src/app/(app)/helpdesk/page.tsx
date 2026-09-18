import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader } from "@/components/common";
import { NativeSelect } from "@/components/common/native-select";
import { Button } from "@/components/ui/button";
import { Pager } from "@/components/psa/pager";
import { listTickets, listTicketsSchema } from "@/server/services/helpdesk";
import { RaiseTicketDialog } from "./raise-ticket-dialog";
import { TicketTable } from "./ticket-table";

export const metadata = { title: "Helpdesk" };
const STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_ON_EMPLOYEE", "RESOLVED", "CLOSED"];

export default async function HelpdeskPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const isAgent = can(actor, "helpdesk:agent") || can(actor, "helpdesk:manage");
  const actions = (
    <>
      {isAgent && <Button variant="outline" nativeButton={false} render={<Link href="/helpdesk/admin" />}>Agent queue</Button>}
      {actor.employeeId && can(actor, "helpdesk:raise") && <RaiseTicketDialog />}
    </>
  );
  if (!actor.employeeId) {
    return <div><PageHeader title="Helpdesk" actions={actions} /><EmptyState title="No employee profile" description="Tickets are raised by employees. Use the agent queue to work on tickets." /></div>;
  }
  const status = STATUSES.includes(String(sp.status)) ? String(sp.status) : undefined;
  const group = sp.status === "closed" ? "closed" : sp.status === "open" || !sp.status ? "open" : undefined;
  const q = listTicketsSchema.parse({ mine: "true", status, statusGroup: status ? undefined : group, page: sp.page ?? "1", pageSize: "25", order: "desc" });
  const page = await listTickets(actor, q);
  return (
    <div>
      <PageHeader title="Helpdesk" description="Raise IT, HR, payroll or facilities requests and follow the conversation." actions={actions} />
      <form method="get" className="mb-4 flex flex-wrap gap-2">
        <NativeSelect name="status" defaultValue={String(sp.status ?? "open")} className="w-52">
          <option value="open">Open tickets</option>
          <option value="closed">Resolved & closed</option>
          <option value="">Everything</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
        </NativeSelect>
        <Button type="submit" variant="outline">Filter</Button>
      </form>
      {page.items.length === 0 ? <EmptyState title="No tickets" description={group === "open" ? "You have no open tickets." : "Nothing here yet."} /> : <div className="rounded-lg border"><TicketTable items={page.items} showAssignee /></div>}
      <Pager page={page.page} pages={page.pages} total={page.total} basePath="/helpdesk" params={sp} />
    </div>
  );
}
