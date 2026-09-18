"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmployeePicker, type EmployeeOption } from "@/components/psa/employee-picker";
import { apiFetch, ApiError } from "@/lib/client/api";

export interface MemberRow { employeeId: string; displayName: string; employeeCode: string; designation: string | null; department: string | null; role: string; allocationPct: number; hours: number; billableHours: number }

export function MembersPanel({ projectId, members, canManage }: { projectId: string; members: MemberRow[]; canManage: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [emp, setEmp] = useState<EmployeeOption | null>(null);
  const [role, setRole] = useState("MEMBER");
  const [alloc, setAlloc] = useState("100");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!emp) return toast.error("Pick an employee");
    setBusy(true);
    try {
      await apiFetch(`/api/v1/projects/${projectId}/members`, { method: "POST", body: { employeeId: emp.id, role, allocationPct: Number(alloc) } });
      toast.success(`${emp.displayName} added`);
      setOpen(false);
      setEmp(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not add member");
    } finally {
      setBusy(false);
    }
  }
  async function remove(m: MemberRow) {
    if (!confirm(`Remove ${m.displayName} from this project?`)) return;
    try {
      await apiFetch(`/api/v1/projects/${projectId}/members?employeeId=${m.employeeId}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not remove member");
    }
  }

  return (
    <div>
      {canManage && (
        <div className="mb-2 flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}><UserPlus /> Add member</Button>
        </div>
      )}
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Allocation</TableHead>
              <TableHead className="text-right">Hours</TableHead>
              <TableHead className="text-right">Billable</TableHead>
              {canManage && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.employeeId}>
                <TableCell>
                  <div className="font-medium">{m.displayName}</div>
                  <div className="text-xs text-muted-foreground">{m.employeeCode}{m.designation ? ` · ${m.designation}` : ""}{m.department ? ` · ${m.department}` : ""}</div>
                </TableCell>
                <TableCell>{m.role}</TableCell>
                <TableCell className="text-right tabular-nums">{m.allocationPct}%</TableCell>
                <TableCell className="text-right tabular-nums">{m.hours}</TableCell>
                <TableCell className="text-right tabular-nums">{m.billableHours}</TableCell>
                {canManage && <TableCell className="text-right"><Button size="icon-xs" variant="ghost" aria-label="Remove" onClick={() => remove(m)}><X /></Button></TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={add} className="contents">
            <DialogHeader>
              <DialogTitle>Add member</DialogTitle>
              <DialogDescription>Members can log time against this project. Re-adding updates role and allocation.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5"><Label>Employee</Label><EmployeePicker value={emp} onChange={setEmp} autoFocus /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5"><Label htmlFor="m-role">Role</Label><Input id="m-role" value={role} onChange={(e) => setRole(e.target.value.toUpperCase())} maxLength={40} /></div>
                <div className="grid gap-1.5"><Label htmlFor="m-alloc">Allocation %</Label><Input id="m-alloc" type="number" min={1} max={100} value={alloc} onChange={(e) => setAlloc(e.target.value)} /></div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy || !emp}>{busy ? "Adding…" : "Add"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
