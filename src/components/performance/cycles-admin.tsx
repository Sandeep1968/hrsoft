"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/common/native-select";
import { apiFetch } from "@/lib/client/api";

const DEFAULT_QUESTIONS = [
  { text: "What were your key achievements this period?", type: "TEXT" },
  { text: "Where could you have done better?", type: "TEXT" },
  { text: "Quality of work", type: "RATING" },
  { text: "Collaboration and communication", type: "RATING" },
  { text: "Ownership and initiative", type: "RATING" },
];

export function CreateCycleDialog({ departments }: { departments: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [questions, setQuestions] = useState(DEFAULT_QUESTIONS);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await apiFetch("/api/v1/review-cycles", {
        method: "POST",
        body: {
          name: fd.get("name"),
          periodStart: fd.get("periodStart"),
          periodEnd: fd.get("periodEnd"),
          selfReviewDue: fd.get("selfReviewDue"),
          managerReviewDue: fd.get("managerReviewDue"),
          ratingScale: Number(fd.get("ratingScale")),
          questions: questions.filter((q) => q.text.trim()).map((q, i) => ({ id: `q${i + 1}`, text: q.text.trim(), type: q.type })),
          includeDepartmentIds: fd.getAll("includeDepartmentIds"),
        },
      });
      toast.success("Cycle created as draft");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}><Plus /> New cycle</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} className="grid max-h-[85vh] gap-4 overflow-y-auto pr-1">
          <DialogHeader>
            <DialogTitle>New review cycle</DialogTitle>
            <DialogDescription>Launching creates one review per active employee who joined at least 90 days before the period ends.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5"><Label htmlFor="cy-name">Name</Label><Input id="cy-name" name="name" required placeholder="H2 2026 performance review" /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label htmlFor="cy-ps">Period start</Label><Input id="cy-ps" name="periodStart" type="date" required /></div>
            <div className="grid gap-1.5"><Label htmlFor="cy-pe">Period end</Label><Input id="cy-pe" name="periodEnd" type="date" required /></div>
            <div className="grid gap-1.5"><Label htmlFor="cy-sd">Self-review due</Label><Input id="cy-sd" name="selfReviewDue" type="date" required /></div>
            <div className="grid gap-1.5"><Label htmlFor="cy-md">Manager review due</Label><Input id="cy-md" name="managerReviewDue" type="date" required /></div>
            <div className="grid gap-1.5">
              <Label htmlFor="cy-scale">Rating scale</Label>
              <NativeSelect id="cy-scale" name="ratingScale" defaultValue="5">{[3, 4, 5, 7, 10].map((n) => <option key={n} value={n}>1 – {n}</option>)}</NativeSelect>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Departments (empty = whole company)</Label>
            <div className="grid max-h-32 grid-cols-2 gap-1 overflow-y-auto rounded-lg border p-2 text-sm">
              {departments.map((d) => <label key={d.id} className="flex items-center gap-2"><input type="checkbox" name="includeDepartmentIds" value={d.id} /> {d.name}</label>)}
            </div>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between"><Label>Questions</Label><Button type="button" size="xs" variant="outline" onClick={() => setQuestions((q) => [...q, { text: "", type: "TEXT" }])}>+ Question</Button></div>
            {questions.map((q, i) => (
              <div key={i} className="flex gap-2">
                <Input value={q.text} onChange={(e) => setQuestions((qs) => qs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} placeholder="Question text" />
                <NativeSelect className="w-28" value={q.type} onChange={(e) => setQuestions((qs) => qs.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>
                  <option value="TEXT">Text</option>
                  <option value="RATING">Rating</option>
                </NativeSelect>
                <Button type="button" size="icon-sm" variant="ghost" onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))} aria-label="Remove">×</Button>
              </div>
            ))}
          </div>
          <DialogFooter showCloseButton><Button type="submit" disabled={busy}>Create draft</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CycleActions({ id, status, size = "xs" }: { id: string; status: string; size?: "xs" | "sm" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function act(path: string, method: "POST" | "DELETE", confirmText: string, done: string) {
    if (!confirm(confirmText)) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/review-cycles/${id}${path}`, { method });
      toast.success(done);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {status === "DRAFT" && <Button size={size} disabled={busy} onClick={() => act("/launch", "POST", "Launch this cycle? Reviews will be created for all eligible employees and they will be notified.", "Cycle launched")}>Launch</Button>}
      {status === "ACTIVE" && <Button size={size} disabled={busy} onClick={() => act("/calibration", "POST", "Move to calibration? Self-reviews will close.", "Cycle moved to calibration")}>Start calibration</Button>}
      {(status === "CALIBRATION" || status === "ACTIVE") && <Button size={size} variant="outline" disabled={busy} onClick={() => act("/complete", "POST", "Complete the cycle and share results with every employee?", "Results shared")}>Complete & share</Button>}
      {status !== "COMPLETED" && <Button size={size} variant="ghost" className="text-destructive" disabled={busy} onClick={() => act("", "DELETE", "Delete this cycle and all its reviews?", "Cycle deleted")}>Delete</Button>}
    </div>
  );
}
