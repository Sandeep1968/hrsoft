"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DL } from "@/components/common";
import { apiFetch } from "@/lib/client/api";
import { fmtDateTime } from "@/lib/dates";
import { Field } from "./field";
import type { EmployeeProfile } from "@/server/services/employees";

export function BankTab({ profile, canEdit, isHr }: { profile: EmployeeProfile; canEdit: boolean; isHr: boolean }) {
  const router = useRouter();
  const s = profile.sensitive;
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ pan: "", aadhaar: "", uan: "", accountHolder: s.bank?.accountHolder ?? profile.displayName, accountNumber: "", ifsc: s.bank?.ifsc ?? "", bankName: s.bank?.bankName ?? "", branch: s.bank?.branch ?? "" });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      if (f.pan) body.pan = f.pan;
      if (isHr && f.aadhaar) body.aadhaar = f.aadhaar;
      if (isHr && f.uan) body.uan = f.uan;
      if (f.accountNumber) body.bank = { accountHolder: f.accountHolder, accountNumber: f.accountNumber, ifsc: f.ifsc, bankName: f.bankName, branch: f.branch || null };
      if (Object.keys(body).length === 0) { toast.info("Enter a value to update"); return; }
      await apiFetch(`/api/v1/employees/${profile.id}/sensitive`, { method: "PATCH", body });
      toast.success("Updated");
      setF({ ...f, pan: "", aadhaar: "", uan: "", accountNumber: "" });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Identity numbers</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <DL items={[{ label: "PAN", value: s.pan ?? "Not provided" }, { label: "Aadhaar", value: s.aadhaar ?? "Not provided" }, { label: "UAN", value: s.uan ?? "Not provided" }, { label: "PF number", value: profile.pfNumber }, { label: "ESI number", value: profile.esiNumber }]} />
          {!s.unmasked && <p className="text-xs text-muted-foreground">Values are masked. Only HR and payroll can view full numbers.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Bank account</CardTitle></CardHeader>
        <CardContent>
          {s.bank ? (
            <DL items={[{ label: "Account holder", value: s.bank.accountHolder }, { label: "Account number", value: s.bank.accountNumber }, { label: "IFSC", value: s.bank.ifsc }, { label: "Bank", value: `${s.bank.bankName}${s.bank.branch ? ` · ${s.bank.branch}` : ""}` }, { label: "Verified", value: s.bank.verifiedAt ? fmtDateTime(s.bank.verifiedAt) : "Pending verification" }]} />
          ) : (
            <p className="text-sm text-muted-foreground">No bank account on file.</p>
          )}
        </CardContent>
      </Card>
      {canEdit && (
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Update</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={save} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="PAN" hint="ABCDE1234F"><Input value={f.pan} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} maxLength={10} /></Field>
              {isHr && <Field label="Aadhaar" hint="12 digits"><Input value={f.aadhaar} onChange={(e) => setF({ ...f, aadhaar: e.target.value })} maxLength={12} /></Field>}
              {isHr && <Field label="UAN" hint="12 digits"><Input value={f.uan} onChange={(e) => setF({ ...f, uan: e.target.value })} maxLength={12} /></Field>}
              <div className="sm:col-span-2 lg:col-span-3 mt-1 text-sm font-medium">Bank account {!isHr && <span className="text-xs font-normal text-muted-foreground">(HR will verify changes)</span>}</div>
              <Field label="Account holder"><Input value={f.accountHolder} onChange={(e) => setF({ ...f, accountHolder: e.target.value })} /></Field>
              <Field label="Account number" hint="Leave blank to keep the current account"><Input value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value })} inputMode="numeric" /></Field>
              <Field label="IFSC"><Input value={f.ifsc} onChange={(e) => setF({ ...f, ifsc: e.target.value.toUpperCase() })} maxLength={11} /></Field>
              <Field label="Bank name"><Input value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} /></Field>
              <Field label="Branch"><Input value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })} /></Field>
              <div className="flex items-end sm:col-span-2 lg:col-span-1"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button></div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
