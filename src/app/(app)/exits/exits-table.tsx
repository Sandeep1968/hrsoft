"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/common/native-select";
import { StatusBadge } from "@/components/common";
import { apiFetch } from "@/lib/client/api";
import { fmtDate } from "@/lib/dates";
import { Field } from "@/components/employees/field";
import type { ExitRequestDto } from "@/server/services/exits";

export function ExitsTable({ items, manage, status }: { items: ExitRequestDto[]; manage: boolean; status: string }) {
  const router = useRouter();
  return (
    <div className="space-y-3">
      {manage && (
        <NativeSelect className="w-48" value={status} onChange={(e) => router.push(e.target.value ? `/exits?status=${e.target.value}` : "/exits")}>
          <option value="">All statuses</option><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="CANCELLED">Cancelled</option>
        </NativeSelect>
      )}
      <div className="rounded-lg border">
        <Table>
          <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Resigned</TableHead><TableHead>Last working day</TableHead><TableHead>Status</TableHead><TableHead>Clearance</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map((e) => {
              const c = e.clearance;
              const cleared = [c.it, c.finance, c.hr, c.manager].filter(Boolean).length;
              return (
                <TableRow key={e.id}>
                  <TableCell><Link href={`/employees/${e.employeeId}`} className="font-medium hover:underline">{e.employee.displayName}</Link><div className="text-xs text-muted-foreground">{e.employee.employeeCode} · {e.employee.designation ?? "—"} · {e.employee.department ?? "—"}</div></TableCell>
                  <TableCell>{fmtDate(e.resignationDate)}</TableCell>
                  <TableCell>{fmtDate(e.lastWorkingDay)}</TableCell>
                  <TableCell><StatusBadge status={e.status} />{e.decisionNote && <div className="mt-1 max-w-[220px] truncate text-xs text-muted-foreground" title={e.decisionNote}>{e.decisionNote}</div>}</TableCell>
                  <TableCell>{e.status === "APPROVED" ? <span className={cleared === 4 ? "text-emerald-700" : ""}>{cleared}/4</span> : "—"}</TableCell>
                  <TableCell className="text-right">
                    {manage && e.status === "PENDING" && <DecideDialog exit={e} />}
                    {manage && e.status === "APPROVED" && <ClearanceDialog exit={e} />}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function DecideDialog({ exit }: { exit: ExitRequestDto }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  async function decide(decision: "APPROVED" | "REJECTED") {
    setBusy(decision);
    try {
      await apiFetch(`/api/v1/exit-requests/${exit.id}/decide`, { method: "POST", body: { decision, note: note || undefined } });
      toast.success(decision === "APPROVED" ? "Resignation accepted" : "Resignation rejected");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update");
    } finally {
      setBusy(null);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>Decide</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resignation — {exit.employee.displayName}</DialogTitle>
          <DialogDescription>Resigned {fmtDate(exit.resignationDate)} · proposed last working day {fmtDate(exit.lastWorkingDay)} · manager {exit.employee.manager ?? "—"}</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-wrap">{exit.reason}</div>
        <Field label="Note to employee"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <DialogFooter showCloseButton>
          <Button variant="destructive" disabled={busy !== null} onClick={() => decide("REJECTED")}>{busy === "REJECTED" ? "…" : "Reject"}</Button>
          <Button disabled={busy !== null} onClick={() => decide("APPROVED")}>{busy === "APPROVED" ? "…" : "Accept resignation"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClearanceDialog({ exit }: { exit: ExitRequestDto }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [c, setC] = useState({ ...exit.clearance, exitInterview: exit.exitInterview ?? "" });
  async function save() {
    setBusy(true);
    try {
      await apiFetch(`/api/v1/exit-requests/${exit.id}`, { method: "PATCH", body: { clearance: { it: c.it, finance: c.finance, hr: c.hr, manager: c.manager, notes: c.notes, exitInterview: c.exitInterview } } });
      toast.success("Clearance updated");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update");
    } finally {
      setBusy(false);
    }
  }
  const items: [keyof typeof exit.clearance, string][] = [["it", "IT — assets returned, accounts disabled"], ["finance", "Finance — dues, advances and reimbursements settled"], ["hr", "HR — exit interview, documents, F&F initiated"], ["manager", "Manager — handover complete"]];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Clearance</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Exit clearance — {exit.employee.displayName}</DialogTitle>
          <DialogDescription>Last working day {fmtDate(exit.lastWorkingDay)}. When all four are cleared and the day has passed, the employee is marked exited and their login suspended.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {items.map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm"><Checkbox checked={Boolean(c[k])} onCheckedChange={(v) => setC({ ...c, [k]: Boolean(v) })} /> {label}</label>
          ))}
        </div>
        <Field label="Notes"><Textarea rows={2} value={c.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} /></Field>
        <Field label="Exit interview summary"><Textarea rows={3} value={c.exitInterview} onChange={(e) => setC({ ...c, exitInterview: e.target.value })} /></Field>
        <DialogFooter showCloseButton>
          <Button disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
