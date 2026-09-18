"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/common/native-select";
import { StatusBadge } from "@/components/common";
import { apiFetch } from "@/lib/client/api";
import { fmtDate } from "@/lib/dates";
import { ProgressBar } from "./progress-bar";
import type { ObjectiveDto } from "@/server/services/performance";

const STATUSES = ["ON_TRACK", "AT_RISK", "OFF_TRACK", "COMPLETED", "ARCHIVED"] as const;
const METRICS = ["NUMBER", "PERCENT", "CURRENCY", "BOOLEAN"] as const;

function fmtValue(v: number, type: string) {
  if (type === "BOOLEAN") return v > 0 ? "Done" : "Not done";
  if (type === "PERCENT") return `${v}%`;
  if (type === "CURRENCY") return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
  return new Intl.NumberFormat("en-IN").format(v);
}

export function ObjectiveCard({ objective, canEdit }: { objective: ObjectiveDto; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editingKr, setEditingKr] = useState<ObjectiveDto["keyResults"][number] | null>(null);
  const [addingKr, setAddingKr] = useState(false);

  async function setStatus(status: string) {
    setBusy(true);
    try {
      await apiFetch(`/api/v1/okrs/${objective.id}`, { method: "PATCH", body: { status } });
      toast.success("Status updated");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm(`Delete "${objective.title}" and its key results?`)) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/okrs/${objective.id}`, { method: "DELETE" });
      toast.success("Objective deleted");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-primary/10 px-1.5 text-[10px] font-medium uppercase tracking-wide text-primary">{objective.level}</span>
              <span className="truncate">{objective.title}</span>
            </CardTitle>
            <div className="mt-1 text-xs text-muted-foreground">
              {objective.ownerName}{objective.departmentName ? ` · ${objective.departmentName}` : ""} · {fmtDate(objective.periodStart)} – {fmtDate(objective.periodEnd)}
              {objective.childCount > 0 && ` · ${objective.childCount} aligned`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canEdit ? (
              <NativeSelect className="h-7 w-auto text-xs" value={objective.status} disabled={busy} onChange={(e) => setStatus(e.target.value)} aria-label="Objective status">
                {STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
              </NativeSelect>
            ) : (
              <StatusBadge status={objective.status} />
            )}
          </div>
        </div>
        {objective.description && <p className="text-sm text-muted-foreground">{objective.description}</p>}
        <ProgressBar value={objective.progress} />
      </CardHeader>
      <CardContent>
        {objective.keyResults.length === 0 && <p className="text-xs text-muted-foreground">No key results yet{objective.childCount ? " — progress rolls up from aligned objectives" : ""}.</p>}
        <ul className="space-y-2.5">
          {objective.keyResults.map((kr) => (
            <li key={kr.id} className="rounded-lg border p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{kr.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {fmtValue(kr.currentValue, kr.metricType)} of {fmtValue(kr.targetValue, kr.metricType)}{kr.metricType !== "BOOLEAN" ? ` (from ${fmtValue(kr.startValue, kr.metricType)})` : ""} · weight {kr.weight}
                  </div>
                </div>
                {canEdit && objective.status !== "ARCHIVED" && <Button size="xs" variant="outline" onClick={() => setEditingKr(kr)}>Update</Button>}
              </div>
              <ProgressBar value={kr.progress} className="mt-1.5" tone="neutral" />
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="xs" variant="ghost" onClick={() => setAddingKr(true)}>+ Key result</Button>
            <Button size="xs" variant="ghost" className="text-destructive" disabled={busy} onClick={remove}>Delete</Button>
          </div>
        )}
      </CardContent>

      {editingKr && <UpdateKrDialog kr={editingKr} onClose={() => setEditingKr(null)} />}
      {addingKr && <AddKrDialog objectiveId={objective.id} onClose={() => setAddingKr(false)} />}
    </Card>
  );
}

function UpdateKrDialog({ kr, onClose }: { kr: ObjectiveDto["keyResults"][number]; onClose: () => void }) {
  const router = useRouter();
  const [value, setValue] = useState(String(kr.currentValue));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch(`/api/v1/key-results/${kr.id}`, { method: "PATCH", body: { value: Number(value), note: note || null } });
      toast.success("Key result updated");
      onClose();
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Update key result</DialogTitle>
            <DialogDescription>{kr.title}</DialogDescription>
          </DialogHeader>
          {kr.metricType === "BOOLEAN" ? (
            <div className="grid gap-2">
              <Label htmlFor="kr-value">Status</Label>
              <NativeSelect id="kr-value" value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="0">Not done</option>
                <option value="1">Done</option>
              </NativeSelect>
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="kr-value">Current value (target {kr.targetValue})</Label>
              <Input id="kr-value" type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} required />
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="kr-note">Note (optional)</Label>
            <Textarea id="kr-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed?" />
          </div>
          <DialogFooter showCloseButton>
            <Button type="submit" disabled={busy}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddKrDialog({ objectiveId, onClose }: { objectiveId: string; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await apiFetch(`/api/v1/okrs/${objectiveId}/key-results`, { method: "POST", body: Object.fromEntries(fd.entries()) });
      toast.success("Key result added");
      onClose();
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader><DialogTitle>Add key result</DialogTitle></DialogHeader>
          <KeyResultFields prefix="" />
          <DialogFooter showCloseButton><Button type="submit" disabled={busy}>Add</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Reusable KR field group (also used by the add-objective dialog). */
export function KeyResultFields({ prefix }: { prefix: string }) {
  return (
    <div className="grid gap-2 sm:grid-cols-6">
      <div className="grid gap-1 sm:col-span-6">
        <Label htmlFor={`${prefix}title`}>Key result</Label>
        <Input id={`${prefix}title`} name={`${prefix}title`} required placeholder="e.g. Increase NPS to 60" />
      </div>
      <div className="grid gap-1 sm:col-span-2">
        <Label htmlFor={`${prefix}metricType`}>Metric</Label>
        <NativeSelect id={`${prefix}metricType`} name={`${prefix}metricType`} defaultValue="NUMBER">
          {METRICS.map((m) => <option key={m} value={m}>{m}</option>)}
        </NativeSelect>
      </div>
      <div className="grid gap-1 sm:col-span-1"><Label htmlFor={`${prefix}startValue`}>Start</Label><Input id={`${prefix}startValue`} name={`${prefix}startValue`} type="number" step="any" defaultValue={0} /></div>
      <div className="grid gap-1 sm:col-span-2"><Label htmlFor={`${prefix}targetValue`}>Target</Label><Input id={`${prefix}targetValue`} name={`${prefix}targetValue`} type="number" step="any" defaultValue={100} /></div>
      <div className="grid gap-1 sm:col-span-1"><Label htmlFor={`${prefix}weight`}>Weight</Label><Input id={`${prefix}weight`} name={`${prefix}weight`} type="number" min={1} max={10} defaultValue={1} /></div>
    </div>
  );
}
