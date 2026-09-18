"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/client/api";
import { fmtMoney } from "@/lib/dates";

export function ReimburseDialog({ open, onOpenChange, claim, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; claim: { id: string; title: string; displayName: string; totalAmount: number; currency: string } | null; onDone?: () => void }) {
  const router = useRouter();
  const [viaPayroll, setViaPayroll] = useState(true);
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!claim) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/expense-claims/${claim.id}/reimburse`, { method: "POST", body: { viaPayroll, paymentRef: viaPayroll ? undefined : ref || undefined } });
      toast.success(viaPayroll ? "Added to the next payroll as a non-taxable reimbursement" : "Marked as reimbursed");
      onOpenChange(false);
      onDone?.();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reimburse claim</DialogTitle>
          <DialogDescription>{claim ? `${claim.displayName} · ${claim.title} · ${fmtMoney(claim.totalAmount, claim.currency)}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Label className="justify-between">
            <span>Pay through payroll (next open month, non-taxable)</span>
            <Switch checked={viaPayroll} onCheckedChange={setViaPayroll} />
          </Label>
          {!viaPayroll && (
            <div className="grid gap-1.5">
              <Label htmlFor="pref">Payment reference</Label>
              <Input id="pref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="UTR / cheque no." />
            </div>
          )}
        </div>
        <DialogFooter showCloseButton>
          <Button onClick={go} disabled={busy || !claim}>{busy ? "Saving…" : "Mark reimbursed"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
