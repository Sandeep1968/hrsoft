"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/common/native-select";
import { apiFetch } from "@/lib/client/api";

const RECS = [["STRONG_HIRE", "Strong hire"], ["HIRE", "Hire"], ["NO_HIRE", "No hire"], ["STRONG_NO_HIRE", "Strong no hire"]] as const;

export function InterviewFeedbackDialog({ interviewId, candidateName, existing }: { interviewId: string; candidateName: string; existing: { rating: number; recommendation: string; notes: string | null } | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await apiFetch(`/api/v1/interviews/${interviewId}/feedback`, { method: "POST", body: { rating: Number(fd.get("rating")), recommendation: fd.get("recommendation"), notes: fd.get("notes") || null } });
      toast.success("Feedback saved");
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
      <DialogTrigger render={<Button size="sm" variant={existing ? "outline" : "default"} />}>{existing ? "Edit feedback" : "Submit feedback"}</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Interview feedback</DialogTitle>
            <DialogDescription>{candidateName}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="if-rating">Rating (1–5)</Label>
            <NativeSelect id="if-rating" name="rating" required defaultValue={existing?.rating ?? ""}>
              <option value="" disabled>Select</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="if-rec">Recommendation</Label>
            <NativeSelect id="if-rec" name="recommendation" required defaultValue={existing?.recommendation ?? ""}>
              <option value="" disabled>Select</option>
              {RECS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="if-notes">Notes</Label><Textarea id="if-notes" name="notes" rows={5} defaultValue={existing?.notes ?? ""} placeholder="Strengths, concerns, examples…" /></div>
          <DialogFooter showCloseButton><Button type="submit" disabled={busy}>Save</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
