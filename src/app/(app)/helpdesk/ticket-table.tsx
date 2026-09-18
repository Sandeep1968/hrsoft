import Link from "next/link";
import { StatusBadge } from "@/components/common";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDateTime } from "@/lib/dates";
import type { TicketDto } from "@/server/services/helpdesk";
import { cn } from "@/lib/utils";

const PRIORITY_TONE: Record<string, string> = { URGENT: "text-red-600 font-semibold", HIGH: "text-amber-600 font-medium", MEDIUM: "", LOW: "text-muted-foreground" };

export function TicketTable({ items, showRaiser, showAssignee }: { items: TicketDto[]; showRaiser?: boolean; showAssignee?: boolean }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No tickets match.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>#</TableHead>
          <TableHead>Subject</TableHead>
          {showRaiser && <TableHead>Raised by</TableHead>}
          <TableHead>Category</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead>Status</TableHead>
          {showAssignee && <TableHead>Assignee</TableHead>}
          <TableHead>Due</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((t) => (
          <TableRow key={t.id}>
            <TableCell className="tabular-nums text-muted-foreground">{t.number}</TableCell>
            <TableCell className="max-w-72 whitespace-normal"><Link href={`/helpdesk/${t.id}`} className="font-medium hover:underline">{t.subject}</Link><div className="text-xs text-muted-foreground">{fmtDateTime(t.createdAt)}</div></TableCell>
            {showRaiser && <TableCell>{t.raiser.displayName}<div className="text-xs text-muted-foreground">{t.raiser.department?.name ?? ""}</div></TableCell>}
            <TableCell>{t.category.name}</TableCell>
            <TableCell className={PRIORITY_TONE[t.priority]}>{t.priority}</TableCell>
            <TableCell><StatusBadge status={t.status} /></TableCell>
            {showAssignee && <TableCell>{t.assignee?.displayName ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>}
            <TableCell className={cn("text-xs", t.isOverdue ? "font-medium text-red-600" : "text-muted-foreground")}>{t.isOverdue ? "Overdue · " : ""}{fmtDateTime(t.dueAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
