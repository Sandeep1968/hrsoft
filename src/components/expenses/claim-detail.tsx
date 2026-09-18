"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, FileText, Paperclip, Send, Trash2, Undo2, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DL } from "@/components/common";
import { apiFetch } from "@/lib/client/api";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/dates";
import type { ClaimDto } from "@/server/services/expenses";
import { ReimburseDialog } from "./reimburse-dialog";

export function ClaimDetail({ claim, perms }: { claim: ClaimDto; perms: { owner: boolean; decide: boolean; reimburse: boolean } }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [decision, setDecision] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [note, setNote] = useState("");
  const [reimburseOpen, setReimburseOpen] = useState(false);

  async function run(label: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(label);
    try {
      await fn();
      if (done) toast.success(done);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }
  const submit = () => run("submit", () => apiFetch(`/api/v1/expense-claims/${claim.id}/submit`, { method: "POST" }), "Submitted for approval");
  const withdraw = () => run("withdraw", () => apiFetch(`/api/v1/expense-claims/${claim.id}/withdraw`, { method: "POST" }), "Claim withdrawn to draft");
  const remove = () => confirm("Delete this draft claim?") && run("delete", async () => { await apiFetch(`/api/v1/expense-claims/${claim.id}`, { method: "DELETE" }); router.push("/expenses"); }, "Draft deleted");
  const decide = () => decision && run("decide", () => apiFetch(`/api/v1/expense-claims/${claim.id}/decide`, { method: "POST", body: { decision, note: note || undefined } }), `Claim ${decision.toLowerCase()}`).then(() => setDecision(null));
  async function upload(itemId: string, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("itemId", itemId);
    await run("upload", async () => {
      const res = await fetch(`/api/v1/expense-claims/${claim.id}/receipt`, { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error?.message ?? "Upload failed");
    }, "Receipt attached");
  }
  const editable = perms.owner && claim.status === "DRAFT";
  const missingReceipts = claim.items.filter((i) => i.requiresReceipt && !i.receiptKey).length;

  const timeline = [
    { at: claim.createdAt, label: "Created" },
    claim.submittedAt && { at: claim.submittedAt, label: `Submitted${claim.approverName ? ` to ${claim.approverName}` : ""}` },
    claim.decidedAt && { at: claim.decidedAt, label: `${claim.status === "REJECTED" ? "Rejected" : "Approved"}${claim.approverName ? ` by ${claim.approverName}` : ""}${claim.decisionNote ? ` — “${claim.decisionNote}”` : ""}` },
    claim.reimbursedAt && { at: claim.reimbursedAt, label: `Reimbursed${claim.paymentRef ? ` · ${claim.paymentRef.startsWith("PAYROLL:") ? "via payroll" : claim.paymentRef}` : ""}` },
  ].filter((t): t is { at: string; label: string } => Boolean(t));

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {editable && <Button onClick={submit} disabled={busy !== null || missingReceipts > 0}><Send /> Submit for approval</Button>}
          {editable && <Button variant="destructive" onClick={remove} disabled={busy !== null}><Trash2 /> Delete draft</Button>}
          {perms.owner && claim.status === "SUBMITTED" && <Button variant="outline" onClick={withdraw} disabled={busy !== null}><Undo2 /> Withdraw</Button>}
          {perms.owner && claim.status === "REJECTED" && <Button onClick={submit} disabled={busy !== null}><Send /> Resubmit</Button>}
          {perms.decide && (
            <>
              <Button onClick={() => setDecision("APPROVED")} disabled={busy !== null}><Check /> Approve</Button>
              <Button variant="destructive" onClick={() => setDecision("REJECTED")} disabled={busy !== null}><X /> Reject</Button>
            </>
          )}
          {perms.reimburse && claim.status === "APPROVED" && <Button onClick={() => setReimburseOpen(true)} disabled={busy !== null}><Wallet /> Mark reimbursed</Button>}
        </div>
        {editable && missingReceipts > 0 && <p className="text-sm text-amber-700 dark:text-amber-300">Attach receipts for {missingReceipts} item{missingReceipts > 1 ? "s" : ""} before submitting.</p>}

        <Card>
          <CardHeader><CardTitle className="text-base">Items</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Merchant / description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Receipt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {claim.items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>{fmtDate(i.date)}</TableCell>
                    <TableCell>{i.categoryName}</TableCell>
                    <TableCell className="max-w-[260px] truncate">{i.merchant ?? ""}{i.merchant && i.description ? " · " : ""}{i.description ?? ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMoney(i.amount, claim.currency)}</TableCell>
                    <TableCell>
                      {i.receiptUrl ? (
                        <a href={i.receiptUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><FileText className="size-3.5" /> View</a>
                      ) : editable || (perms.owner && claim.status === "SUBMITTED") ? (
                        <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                          <Paperclip className="size-3.5" /> Attach
                          <input type="file" className="hidden" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => e.target.files?.[0] && upload(i.id, e.target.files[0])} />
                        </label>
                      ) : (
                        <span className="text-xs text-muted-foreground">{i.requiresReceipt ? "Missing" : "—"}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell colSpan={3}>Total</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(claim.totalAmount, claim.currency)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent>
            <DL items={[{ label: "Employee", value: claim.displayName }, { label: "Approver", value: claim.approverName ?? "Any approver" }, { label: "Currency", value: claim.currency }, { label: "Payment ref", value: claim.paymentRef?.startsWith("PAYROLL:") ? "Via payroll" : claim.paymentRef }]} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Timeline</CardTitle></CardHeader>
          <CardContent>
            <ol className="space-y-3 text-sm">
              {timeline.map((t) => (
                <li key={t.label} className="flex gap-2">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                  <div><div>{t.label}</div><div className="text-xs text-muted-foreground">{fmtDateTime(t.at)}</div></div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <Dialog open={decision !== null} onOpenChange={(o) => !o && setDecision(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decision === "APPROVED" ? "Approve claim" : "Reject claim"}</DialogTitle>
            <DialogDescription>{claim.displayName} · {fmtMoney(claim.totalAmount, claim.currency)}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="note">Note {decision === "REJECTED" && "(shown to the employee)"}</Label>
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </div>
          <DialogFooter showCloseButton>
            <Button variant={decision === "REJECTED" ? "destructive" : "default"} onClick={decide} disabled={busy !== null}>{decision === "APPROVED" ? "Approve" : "Reject"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReimburseDialog open={reimburseOpen} onOpenChange={setReimburseOpen} claim={claim} />
    </div>
  );
}
