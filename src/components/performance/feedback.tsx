"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/common/native-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/client/api";
import { EmployeePicker, type PickedEmployee } from "./employee-picker";
import type { ReviewQuestion } from "@/server/services/performance";

export function RequestFeedbackDialog({ selfId, canPickSubject, cycles }: { selfId: string; canPickSubject: boolean; cycles: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [subject, setSubject] = useState<PickedEmployee[]>([]);
  const [providers, setProviders] = useState<PickedEmployee[]>([]);
  const [anonymous, setAnonymous] = useState(true);
  const [cycleId, setCycleId] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (providers.length === 0) return toast.error("Pick at least one person");
    setBusy(true);
    try {
      const r = await apiFetch<{ created: number; skipped: number }>("/api/v1/feedback-requests", { method: "POST", body: { subjectId: subject[0]?.id ?? selfId, providerIds: providers.map((p) => p.id), isAnonymous: anonymous, cycleId: cycleId || null } });
      toast.success(`${r.created} request${r.created === 1 ? "" : "s"} sent${r.skipped ? ` (${r.skipped} already pending)` : ""}`);
      setOpen(false);
      setProviders([]);
      setSubject([]);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>Request feedback</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Request 360° feedback</DialogTitle>
            <DialogDescription>Colleagues answer four short questions. Anonymous requests hide who said what.</DialogDescription>
          </DialogHeader>
          {canPickSubject && (
            <div className="grid gap-1.5">
              <Label>About (leave empty for yourself)</Label>
              <EmployeePicker value={subject} onChange={setSubject} placeholder="Search a report…" />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label>Ask</Label>
            <EmployeePicker value={providers} onChange={setProviders} multiple exclude={[subject[0]?.id ?? selfId]} placeholder="Add colleagues…" />
          </div>
          {cycles.length > 0 && (
            <div className="grid gap-1.5">
              <Label htmlFor="fb-cycle">Review cycle (optional)</Label>
              <NativeSelect id="fb-cycle" value={cycleId} onChange={(e) => setCycleId(e.target.value)}>
                <option value="">— none —</option>
                {cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} /> Anonymous responses</label>
          <DialogFooter showCloseButton><Button type="submit" disabled={busy}>Send requests</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SubmitFeedbackDialog({ request }: { request: { id: string; subjectName: string; questions: ReviewQuestion[]; isAnonymous: boolean } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const answers = request.questions.map((q) => ({ questionId: q.id, value: q.type === "RATING" ? Number(fd.get(q.id)) : String(fd.get(q.id) ?? "") }));
    setBusy(true);
    try {
      await apiFetch(`/api/v1/feedback-requests/${request.id}`, { method: "POST", body: { answers } });
      toast.success("Feedback submitted — thank you");
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
      <DialogTrigger render={<Button size="sm" />}>Give feedback</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid max-h-[85vh] gap-4 overflow-y-auto pr-1">
          <DialogHeader>
            <DialogTitle>Feedback about {request.subjectName}</DialogTitle>
            <DialogDescription>{request.isAnonymous ? "Your name will not be shown with your answers." : "Your name will be visible with your answers."}</DialogDescription>
          </DialogHeader>
          {request.questions.map((q) => (
            <div key={q.id} className="grid gap-1.5">
              <Label htmlFor={`fb-${q.id}`}>{q.text}</Label>
              {q.type === "RATING" ? (
                <NativeSelect id={`fb-${q.id}`} name={q.id} required defaultValue="">
                  <option value="" disabled>1 (low) – 5 (high)</option>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </NativeSelect>
              ) : (
                <Textarea id={`fb-${q.id}`} name={q.id} required />
              )}
            </div>
          ))}
          <DialogFooter showCloseButton><Button type="submit" disabled={busy}>Submit</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface Summary { requested: number; submitted: number; providers: string[] | null; questions: { id: string; text: string; type: string; average: number | null; count: number; texts: { text: string; from: string | null }[] }[] }

/** Manager / HR: pick a report and view the aggregated 360° summary. */
export function FeedbackSummaryPanel() {
  const [subject, setSubject] = useState<PickedEmployee[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  async function load() {
    if (!subject[0]) return;
    setBusy(true);
    try {
      setSummary(await apiFetch<Summary>(`/api/v1/feedback-summary?subjectId=${subject[0].id}`));
    } catch (err) {
      toast.error((err as Error).message);
      setSummary(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Feedback summary for a report</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex-1"><EmployeePicker value={subject} onChange={(v) => { setSubject(v); setSummary(null); }} placeholder="Search a report…" /></div>
          <Button variant="outline" onClick={load} disabled={busy || !subject[0]}>View summary</Button>
        </div>
        {summary && (
          <div className="grid gap-3 text-sm">
            <p className="text-muted-foreground">{summary.submitted} of {summary.requested} responses received{summary.providers ? ` from ${summary.providers.join(", ")}` : " (anonymous)"}.</p>
            {summary.questions.map((q) => (
              <div key={q.id} className="rounded-lg border p-3">
                <div className="font-medium">{q.text}</div>
                {q.type === "RATING" ? (
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{q.average ?? "—"}<span className="text-sm font-normal text-muted-foreground"> / 5 · {q.count} rating{q.count === 1 ? "" : "s"}</span></div>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {q.texts.length === 0 && <li className="text-muted-foreground">No answers yet.</li>}
                    {q.texts.map((t, i) => <li key={i} className="rounded bg-muted/50 p-2">“{t.text}”{t.from && <span className="text-xs text-muted-foreground"> — {t.from}</span>}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
