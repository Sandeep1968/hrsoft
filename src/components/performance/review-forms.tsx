"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/common/native-select";
import { apiFetch } from "@/lib/client/api";
import type { ReviewQuestion } from "@/server/services/performance";

type Answer = { questionId: string; value: string | number };

/** Question list + overall rating; shared by self and manager reviews. */
export function ReviewQuestionFields({ questions, scale, readOnlyAnswers, prefix }: { questions: ReviewQuestion[]; scale: number; readOnlyAnswers?: Answer[] | null; prefix: string }) {
  const answerOf = (id: string) => readOnlyAnswers?.find((a) => a.questionId === id)?.value;
  return (
    <div className="grid gap-4">
      {questions.map((q) => (
        <div key={q.id} className="grid gap-1.5">
          <Label htmlFor={`${prefix}${q.id}`}>{q.text}</Label>
          {readOnlyAnswers ? (
            <div className="rounded-lg bg-muted/50 p-2 text-sm">{q.type === "RATING" ? `${answerOf(q.id) ?? "—"} / ${scale}` : String(answerOf(q.id) ?? "—")}</div>
          ) : q.type === "RATING" ? (
            <NativeSelect id={`${prefix}${q.id}`} name={`${prefix}${q.id}`} required defaultValue="">
              <option value="" disabled>Select rating</option>
              {Array.from({ length: scale }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
            </NativeSelect>
          ) : (
            <Textarea id={`${prefix}${q.id}`} name={`${prefix}${q.id}`} required minLength={2} />
          )}
        </div>
      ))}
    </div>
  );
}

function collect(fd: FormData, questions: ReviewQuestion[], prefix: string): Answer[] {
  return questions.map((q) => ({ questionId: q.id, value: q.type === "RATING" ? Number(fd.get(`${prefix}${q.id}`)) : String(fd.get(`${prefix}${q.id}`) ?? "") }));
}

export function SelfReviewForm({ reviewId, questions, scale }: { reviewId: string; questions: ReviewQuestion[]; scale: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (!confirm("Submit your self-review? You cannot edit it afterwards.")) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/reviews/${reviewId}/self`, { method: "POST", body: { answers: collect(fd, questions, "self."), rating: Number(fd.get("rating")) } });
      toast.success("Self-review submitted");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <ReviewQuestionFields questions={questions} scale={scale} prefix="self." />
      <div className="grid gap-1.5">
        <Label htmlFor="self-rating">Overall self-rating (1–{scale})</Label>
        <NativeSelect id="self-rating" name="rating" required defaultValue="">
          <option value="" disabled>Select</option>
          {Array.from({ length: scale }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
        </NativeSelect>
      </div>
      <div><Button type="submit" disabled={busy}>Submit self-review</Button></div>
    </form>
  );
}

export interface TeamReviewRow {
  id: string;
  employeeName: string;
  designation: string | null;
  status: string;
  selfRating: number | null;
  selfAnswers: Answer[] | null;
  managerRating: number | null;
  managerAnswers: Answer[] | null;
  finalRating: number | null;
}

export function ManagerReviewDialog({ review, questions, scale, cycleOpen }: { review: TeamReviewRow; questions: ReviewQuestion[]; scale: number; cycleOpen: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const canWrite = cycleOpen && (review.status === "NOT_STARTED" || review.status === "SELF_SUBMITTED");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await apiFetch(`/api/v1/reviews/${review.id}/manager`, { method: "POST", body: { answers: collect(fd, questions, "mgr."), rating: Number(fd.get("rating")) } });
      toast.success("Manager review submitted");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button size="xs" variant={canWrite ? "default" : "outline"} onClick={() => setOpen(true)}>{canWrite ? "Write review" : "View"}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <form onSubmit={submit} className="grid max-h-[85vh] gap-4 overflow-y-auto pr-1">
            <DialogHeader>
              <DialogTitle>{review.employeeName}</DialogTitle>
              <DialogDescription>{review.designation ?? ""} · {review.status.replaceAll("_", " ")}</DialogDescription>
            </DialogHeader>
            <section>
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Self-review {review.selfRating !== null && `· rated ${review.selfRating}/${scale}`}</h4>
              {review.selfAnswers ? <ReviewQuestionFields questions={questions} scale={scale} readOnlyAnswers={review.selfAnswers} prefix="ro." /> : <p className="text-sm text-muted-foreground">Not submitted yet.</p>}
            </section>
            <section>
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Manager review {review.managerRating !== null && `· rated ${review.managerRating}/${scale}`}</h4>
              {canWrite ? (
                <>
                  <ReviewQuestionFields questions={questions} scale={scale} prefix="mgr." />
                  <div className="mt-4 grid gap-1.5">
                    <Label htmlFor="mgr-rating">Overall rating (1–{scale})</Label>
                    <NativeSelect id="mgr-rating" name="rating" required defaultValue="">
                      <option value="" disabled>Select</option>
                      {Array.from({ length: scale }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                    </NativeSelect>
                  </div>
                </>
              ) : review.managerAnswers ? (
                <ReviewQuestionFields questions={questions} scale={scale} readOnlyAnswers={review.managerAnswers} prefix="rom." />
              ) : (
                <p className="text-sm text-muted-foreground">Not available.</p>
              )}
              {review.finalRating !== null && <p className="mt-3 text-sm">Calibrated final rating: <strong>{review.finalRating}/{scale}</strong></p>}
            </section>
            <DialogFooter showCloseButton>{canWrite && <Button type="submit" disabled={busy}>Submit review</Button>}</DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
