"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { StatusBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch, ApiError } from "@/lib/client/api";
import { fmtDate } from "@/lib/dates";

export interface LeaveRowDto {
  id: string;
  startDate: string;
  endDate: string;
  startHalf: string | null;
  endHalf: string | null;
  days: number;
  reason: string;
  status: string;
  decisionNote: string | null;
  createdAt: string;
  leaveType: { name: string; code: string; color: string };
  approver?: { displayName: string } | null;
}

export function LeaveRequestsTable({ items, today }: { items: LeaveRowDto[]; today: string }) {
  const router = useRouter();
  async function cancel(id: string) {
    if (!confirm("Cancel this leave request?")) return;
    try {
      await apiFetch(`/api/v1/leave-requests/${id}`, { method: "DELETE" });
      toast.success("Leave cancelled");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not cancel");
    }
  }
  if (items.length === 0) return <p className="text-sm text-muted-foreground">You have not applied for any leave yet.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead>Dates</TableHead>
          <TableHead className="text-right">Days</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Status</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((r) => {
          const cancellable = r.status === "PENDING" || (r.status === "APPROVED" && r.startDate > today);
          return (
            <TableRow key={r.id}>
              <TableCell>
                <span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: r.leaveType.color }} />{r.leaveType.name}</span>
              </TableCell>
              <TableCell>
                {fmtDate(r.startDate)}{r.startHalf ? <span className="text-xs text-muted-foreground"> ({r.startHalf === "FIRST_HALF" ? "1st half" : "2nd half"})</span> : null}
                {r.endDate !== r.startDate && <> → {fmtDate(r.endDate)}{r.endHalf ? <span className="text-xs text-muted-foreground"> ({r.endHalf === "FIRST_HALF" ? "1st half" : "2nd half"})</span> : null}</>}
              </TableCell>
              <TableCell className="text-right tabular-nums">{r.days}</TableCell>
              <TableCell className="max-w-56 whitespace-normal">{r.reason}{r.decisionNote ? <span className="block text-xs text-muted-foreground">{r.approver?.displayName ? `${r.approver.displayName}: ` : "Note: "}{r.decisionNote}</span> : null}</TableCell>
              <TableCell><StatusBadge status={r.status} /></TableCell>
              <TableCell className="text-right">{cancellable && <Button size="xs" variant="ghost" onClick={() => cancel(r.id)}>Cancel</Button>}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
