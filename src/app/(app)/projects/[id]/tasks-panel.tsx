"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/common/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch, ApiError } from "@/lib/client/api";

export interface TaskRow { id: string; name: string; isBillable: boolean; estimateHours: number | null; status: string; hours: number }
const TASK_STATUSES = ["OPEN", "IN_PROGRESS", "DONE", "CLOSED"];

export function TasksPanel({ projectId, tasks, canManage }: { projectId: string; tasks: TaskRow[]; canManage: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [estimate, setEstimate] = useState("");
  const [billable, setBillable] = useState(true);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch(`/api/v1/projects/${projectId}/tasks`, { method: "POST", body: { name, isBillable: billable, estimateHours: estimate === "" ? null : Number(estimate), status: "OPEN" } });
      setName("");
      setEstimate("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not add task");
    } finally {
      setBusy(false);
    }
  }
  async function setStatus(t: TaskRow, status: string) {
    try {
      await apiFetch(`/api/v1/projects/${projectId}/tasks/${t.id}`, { method: "PATCH", body: { status } });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update task");
    }
  }
  async function remove(t: TaskRow) {
    if (!confirm(`Delete task "${t.name}"?`)) return;
    try {
      await apiFetch(`/api/v1/projects/${projectId}/tasks/${t.id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete task");
    }
  }

  return (
    <div>
      {canManage && (
        <form onSubmit={add} className="mb-3 grid gap-2 sm:grid-cols-[1fr_8rem_auto_auto]">
          <Input placeholder="New task name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} />
          <Input type="number" min={0} step="0.5" placeholder="Estimate h" value={estimate} onChange={(e) => setEstimate(e.target.value)} />
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={billable} onCheckedChange={(v) => setBillable(Boolean(v))} /> Billable</label>
          <Button type="submit" size="sm" disabled={busy}><Plus /> Add</Button>
        </form>
      )}
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tasks yet — time can still be logged against the project itself.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Logged</TableHead>
              <TableHead className="text-right">Estimate</TableHead>
              {canManage && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.isBillable ? "Billable" : "Non-billable"}</div>
                </TableCell>
                <TableCell>
                  {canManage ? (
                    <NativeSelect className="w-36" value={t.status} onChange={(e) => setStatus(t, e.target.value)}>
                      {TASK_STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
                    </NativeSelect>
                  ) : t.status.replaceAll("_", " ")}
                </TableCell>
                <TableCell className="text-right tabular-nums">{t.hours}h</TableCell>
                <TableCell className="text-right tabular-nums">{t.estimateHours === null ? "—" : `${t.estimateHours}h`}{t.estimateHours && t.hours > t.estimateHours ? <span className="ml-1 text-xs text-red-600">over</span> : null}</TableCell>
                {canManage && <TableCell className="text-right">{t.hours === 0 && <Button size="icon-xs" variant="ghost" aria-label="Delete" onClick={() => remove(t)}><Trash2 /></Button>}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
