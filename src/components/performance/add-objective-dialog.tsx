"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/common/native-select";
import { apiFetch } from "@/lib/client/api";
import { EmployeePicker, type PickedEmployee } from "./employee-picker";
import { KeyResultFields } from "./objective-card";

interface ParentOption { id: string; title: string; level: string }

export function AddObjectiveDialog({ allowedLevels, defaultStart, defaultEnd, parents, canPickOwner }: { allowedLevels: string[]; defaultStart: string; defaultEnd: string; parents: ParentOption[]; canPickOwner: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [krCount, setKrCount] = useState(2);
  const [level, setLevel] = useState(allowedLevels.includes("INDIVIDUAL") ? "INDIVIDUAL" : allowedLevels[0]);
  const [owner, setOwner] = useState<PickedEmployee[]>([]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const keyResults = [];
    for (let i = 0; i < krCount; i++) {
      const title = String(fd.get(`kr${i}.title`) ?? "").trim();
      if (!title) continue;
      keyResults.push({ title, metricType: fd.get(`kr${i}.metricType`), startValue: Number(fd.get(`kr${i}.startValue`)), targetValue: Number(fd.get(`kr${i}.targetValue`)), weight: Number(fd.get(`kr${i}.weight`)) });
    }
    setBusy(true);
    try {
      await apiFetch("/api/v1/okrs", {
        method: "POST",
        body: {
          title: fd.get("title"),
          description: fd.get("description") || null,
          level,
          periodStart: fd.get("periodStart"),
          periodEnd: fd.get("periodEnd"),
          parentId: fd.get("parentId") || null,
          ownerId: owner[0]?.id ?? null,
          keyResults,
        },
      });
      toast.success("Objective created");
      setOpen(false);
      setOwner([]);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}><Plus /> New objective</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} className="grid max-h-[85vh] gap-4 overflow-y-auto pr-1">
          <DialogHeader>
            <DialogTitle>New objective</DialogTitle>
            <DialogDescription>Objectives are ambitious outcomes; key results measure progress towards them.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="obj-title">Objective</Label>
            <Input id="obj-title" name="title" required placeholder="e.g. Delight customers with a faster onboarding" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="obj-desc">Description</Label>
            <Textarea id="obj-desc" name="description" placeholder="Why this matters and how success looks" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="obj-level">Level</Label>
              <NativeSelect id="obj-level" value={level} onChange={(e) => setLevel(e.target.value)}>
                {allowedLevels.map((l) => <option key={l} value={l}>{l}</option>)}
              </NativeSelect>
            </div>
            <div className="grid gap-2"><Label htmlFor="obj-start">Period start</Label><Input id="obj-start" name="periodStart" type="date" defaultValue={defaultStart} required /></div>
            <div className="grid gap-2"><Label htmlFor="obj-end">Period end</Label><Input id="obj-end" name="periodEnd" type="date" defaultValue={defaultEnd} required /></div>
          </div>
          {(canPickOwner || level !== "INDIVIDUAL") && (
            <div className="grid gap-2">
              <Label>Owner {level === "INDIVIDUAL" ? "(leave empty for yourself)" : ""}</Label>
              <EmployeePicker value={owner} onChange={setOwner} placeholder="Search employee…" />
            </div>
          )}
          {parents.length > 0 && (
            <div className="grid gap-2">
              <Label htmlFor="obj-parent">Aligns to (optional)</Label>
              <NativeSelect id="obj-parent" name="parentId" defaultValue="">
                <option value="">— none —</option>
                {parents.map((p) => <option key={p.id} value={p.id}>[{p.level}] {p.title}</option>)}
              </NativeSelect>
            </div>
          )}
          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <Label>Key results</Label>
              <Button type="button" size="xs" variant="outline" onClick={() => setKrCount((c) => Math.min(c + 1, 10))}>+ Add</Button>
            </div>
            {Array.from({ length: krCount }, (_, i) => (
              <div key={i} className="rounded-lg border p-3">
                <KeyResultFields prefix={`kr${i}.`} />
              </div>
            ))}
          </div>
          <DialogFooter showCloseButton>
            <Button type="submit" disabled={busy}>Create objective</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
