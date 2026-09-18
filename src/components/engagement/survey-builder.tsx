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

interface Q { text: string; type: string; options: string; required: boolean }
const TYPES = [["RATING", "Rating 1–5"], ["NPS", "NPS 0–10"], ["CHOICE", "Single choice"], ["MULTI_CHOICE", "Multiple choice"], ["TEXT", "Free text"]] as const;
const TEMPLATES: Record<string, Q[]> = {
  ENPS: [{ text: "How likely are you to recommend this company as a place to work?", type: "NPS", options: "", required: true }, { text: "What is the main reason for your score?", type: "TEXT", options: "", required: false }],
  PULSE: [{ text: "I feel motivated at work this week", type: "RATING", options: "", required: true }, { text: "My workload is manageable", type: "RATING", options: "", required: true }, { text: "Anything we should know?", type: "TEXT", options: "", required: false }],
  ENGAGEMENT: [{ text: "I understand how my work contributes to company goals", type: "RATING", options: "", required: true }, { text: "My manager supports my growth", type: "RATING", options: "", required: true }, { text: "I have the tools I need to do my job well", type: "RATING", options: "", required: true }, { text: "How likely are you to recommend this company as a place to work?", type: "NPS", options: "", required: true }, { text: "What would make this a better place to work?", type: "TEXT", options: "", required: false }],
  EXIT: [{ text: "Primary reason for leaving", type: "CHOICE", options: "Compensation, Career growth, Manager, Work-life balance, Relocation, Other", required: true }, { text: "Would you consider returning?", type: "CHOICE", options: "Yes, Maybe, No", required: true }, { text: "What could we have done differently?", type: "TEXT", options: "", required: false }],
  CUSTOM: [{ text: "", type: "RATING", options: "", required: true }],
};

export interface SurveyFormValues { id?: string; title: string; description: string | null; type: string; isAnonymous: boolean; startsAt: string | null; endsAt: string | null; targetDepartmentIds: string[]; questions: { text: string; type: string; options: string[]; required: boolean }[] }

export function SurveyBuilderDialog({ departments, survey }: { departments: { id: string; name: string }[]; survey?: SurveyFormValues }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState(survey?.type ?? "PULSE");
  const [questions, setQuestions] = useState<Q[]>(survey ? survey.questions.map((q) => ({ ...q, options: q.options.join(", ") })) : TEMPLATES.PULSE);
  const toLocal = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : "");

  function changeType(t: string) {
    setType(t);
    if (!survey) setQuestions(TEMPLATES[t] ?? TEMPLATES.CUSTOM);
  }
  const update = (i: number, patch: Partial<Q>) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      title: fd.get("title"),
      description: fd.get("description") || null,
      type,
      isAnonymous: fd.get("isAnonymous") === "on",
      startsAt: fd.get("startsAt") ? new Date(String(fd.get("startsAt"))).toISOString() : null,
      endsAt: fd.get("endsAt") ? new Date(String(fd.get("endsAt"))).toISOString() : null,
      targetDepartmentIds: fd.getAll("targetDepartmentIds"),
      questions: questions.filter((q) => q.text.trim()).map((q) => ({ text: q.text.trim(), type: q.type, options: q.options.split(",").map((o) => o.trim()).filter(Boolean), required: q.required })),
    };
    setBusy(true);
    try {
      if (survey?.id) await apiFetch(`/api/v1/surveys/${survey.id}`, { method: "PATCH", body });
      else await apiFetch("/api/v1/surveys", { method: "POST", body });
      toast.success(survey ? "Survey updated" : "Survey saved as draft");
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
      <DialogTrigger render={survey ? <Button size="xs" variant="outline" /> : <Button />}>{survey ? "Edit" : <><Plus /> New survey</>}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} className="grid max-h-[85vh] gap-4 overflow-y-auto pr-1">
          <DialogHeader>
            <DialogTitle>{survey ? "Edit survey" : "New survey"}</DialogTitle>
            <DialogDescription>Anonymous surveys never store who answered; department breakdowns are shown only with 5+ responses.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="grid gap-1.5"><Label htmlFor="sv-title">Title</Label><Input id="sv-title" name="title" required defaultValue={survey?.title} /></div>
            <div className="grid gap-1.5"><Label htmlFor="sv-type">Type</Label><NativeSelect id="sv-type" value={type} onChange={(e) => changeType(e.target.value)} className="w-40">{["PULSE", "ENPS", "ENGAGEMENT", "EXIT", "CUSTOM"].map((t) => <option key={t} value={t}>{t}</option>)}</NativeSelect></div>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="sv-desc">Description</Label><Textarea id="sv-desc" name="description" rows={2} defaultValue={survey?.description ?? ""} /></div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5"><Label htmlFor="sv-start">Opens</Label><Input id="sv-start" name="startsAt" type="datetime-local" defaultValue={toLocal(survey?.startsAt ?? null)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="sv-end">Closes</Label><Input id="sv-end" name="endsAt" type="datetime-local" defaultValue={toLocal(survey?.endsAt ?? null)} /></div>
            <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="isAnonymous" defaultChecked={survey?.isAnonymous ?? true} /> Anonymous</label>
          </div>
          <div className="grid gap-1.5">
            <Label>Target departments (none = everyone)</Label>
            <div className="grid max-h-28 grid-cols-2 gap-1 overflow-y-auto rounded-lg border p-2 text-sm sm:grid-cols-3">
              {departments.map((d) => <label key={d.id} className="flex items-center gap-2"><input type="checkbox" name="targetDepartmentIds" value={d.id} defaultChecked={survey?.targetDepartmentIds.includes(d.id)} /> {d.name}</label>)}
            </div>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between"><Label>Questions</Label><Button type="button" size="xs" variant="outline" onClick={() => setQuestions((qs) => [...qs, { text: "", type: "RATING", options: "", required: true }])}>+ Question</Button></div>
            {questions.map((q, i) => (
              <div key={i} className="grid gap-2 rounded-lg border p-2.5">
                <div className="flex gap-2">
                  <span className="pt-1.5 text-xs text-muted-foreground">{i + 1}.</span>
                  <Input value={q.text} onChange={(e) => update(i, { text: e.target.value })} placeholder="Question text" />
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))} aria-label="Remove">×</Button>
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-5">
                  <NativeSelect className="w-40" value={q.type} onChange={(e) => update(i, { type: e.target.value })}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect>
                  {(q.type === "CHOICE" || q.type === "MULTI_CHOICE") && <Input className="flex-1" value={q.options} onChange={(e) => update(i, { options: e.target.value })} placeholder="Options, comma separated" />}
                  <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={q.required} onChange={(e) => update(i, { required: e.target.checked })} /> Required</label>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter showCloseButton><Button type="submit" disabled={busy}>{survey ? "Save" : "Save draft"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SurveyActions({ id, status, size = "xs" }: { id: string; status: string; size?: "xs" | "sm" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function act(path: string, method: "POST" | "DELETE", confirmText: string, done: string) {
    if (!confirm(confirmText)) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/surveys/${id}${path}`, { method });
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
      {status === "DRAFT" && <Button size={size} disabled={busy} onClick={() => act("/launch", "POST", "Launch this survey? Every targeted employee will be notified.", "Survey launched")}>Launch</Button>}
      {status === "ACTIVE" && <Button size={size} variant="outline" disabled={busy} onClick={() => act("/close", "POST", "Close this survey to new responses?", "Survey closed")}>Close</Button>}
      <Button size={size} variant="ghost" className="text-destructive" disabled={busy} onClick={() => act("", "DELETE", "Delete this survey and all responses?", "Survey deleted")}>Delete</Button>
    </div>
  );
}
