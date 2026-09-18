"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import type { SurveyDto } from "@/server/services/engagement";

export function SurveyRespondForm({ survey }: { survey: SurveyDto }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number | string | string[]>>({});
  const set = (id: string, v: number | string | string[]) => setAnswers((a) => ({ ...a, [id]: v }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch(`/api/v1/surveys/${survey.id}/respond`, { method: "POST", body: { answers } });
      toast.success("Thanks — your response has been recorded");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-5">
      {survey.questions.map((q, i) => (
        <div key={q.id} className="grid gap-2">
          <Label className="leading-snug">{i + 1}. {q.text}{q.required && <span className="text-destructive">*</span>}</Label>
          {q.type === "RATING" || q.type === "NPS" ? (
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: q.type === "RATING" ? 5 : 11 }, (_, k) => (q.type === "RATING" ? k + 1 : k)).map((n) => (
                <button key={n} type="button" onClick={() => set(q.id, n)} className={cn("size-9 rounded-lg border text-sm tabular-nums transition-colors", answers[q.id] === n ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>{n}</button>
              ))}
              {q.type === "NPS" && <span className="self-center pl-2 text-xs text-muted-foreground">0 = not likely · 10 = extremely likely</span>}
            </div>
          ) : q.type === "CHOICE" ? (
            <div className="grid gap-1">
              {q.options.map((o) => <label key={o} className="flex items-center gap-2 text-sm"><input type="radio" name={q.id} checked={answers[q.id] === o} onChange={() => set(q.id, o)} /> {o}</label>)}
            </div>
          ) : q.type === "MULTI_CHOICE" ? (
            <div className="grid gap-1">
              {q.options.map((o) => {
                const cur = (answers[q.id] as string[] | undefined) ?? [];
                return <label key={o} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cur.includes(o)} onChange={(e) => set(q.id, e.target.checked ? [...cur, o] : cur.filter((x) => x !== o))} /> {o}</label>;
              })}
            </div>
          ) : (
            <Textarea value={(answers[q.id] as string | undefined) ?? ""} onChange={(e) => set(q.id, e.target.value)} rows={3} />
          )}
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>Submit response</Button>
        <span className="text-xs text-muted-foreground">{survey.isAnonymous ? "Anonymous — your identity is not stored with your answers." : "Your name will be attached to this response."}</span>
      </div>
    </form>
  );
}
