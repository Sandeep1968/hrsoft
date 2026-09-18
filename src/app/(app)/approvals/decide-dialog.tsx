"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, ApiError } from "@/lib/client/api";

/**
 * Approve / Reject buttons that POST to a shared-contract decide URL
 * (`/api/v1/<resource>/:id/decide`) after collecting an optional note.
 */
export function DecideButtons({ decideUrl, title, onDone, size = "sm" }: { decideUrl: string; title?: string; onDone?: (decision: "APPROVED" | "REJECTED") => void; size?: "xs" | "sm" | "default" }) {
  const router = useRouter();
  const [decision, setDecision] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!decision) return;
    setBusy(true);
    try {
      await apiFetch(decideUrl, { method: "POST", body: { decision, note: note.trim() || undefined } });
      toast.success(decision === "APPROVED" ? "Approved" : "Rejected");
      setDecision(null);
      setNote("");
      onDone?.(decision);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-1.5">
        <Button size={size} variant="outline" className="text-emerald-700 dark:text-emerald-300" onClick={() => setDecision("APPROVED")}>
          <Check /> Approve
        </Button>
        <Button size={size} variant="outline" className="text-red-700 dark:text-red-300" onClick={() => setDecision("REJECTED")}>
          <X /> Reject
        </Button>
      </div>
      <Dialog open={decision !== null} onOpenChange={(o) => !o && setDecision(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decision === "APPROVED" ? "Approve" : "Reject"} request</DialogTitle>
            {title && <DialogDescription>{title}</DialogDescription>}
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="decide-note">Note {decision === "REJECTED" ? "(recommended)" : "(optional)"}</Label>
            <Textarea id="decide-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visible to the employee" maxLength={500} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecision(null)} disabled={busy}>Cancel</Button>
            <Button variant={decision === "REJECTED" ? "destructive" : "default"} onClick={submit} disabled={busy}>
              {busy ? "Saving…" : decision === "APPROVED" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
