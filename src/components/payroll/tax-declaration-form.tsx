"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/common";
import { apiFetch } from "@/lib/client/api";
import { fmtMoney } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { DeclarationDto, TaxProjection } from "@/server/services/payroll";

const SECTIONS: { key: string; label: string; hint: string; oldOnly?: boolean }[] = [
  { key: "80C", label: "80C — PF, PPF, ELSS, LIC, tuition, home-loan principal", hint: "Cap ₹1,50,000 (employee PF is added automatically)", oldOnly: true },
  { key: "80CCD1B", label: "80CCD(1B) — NPS self contribution", hint: "Cap ₹50,000", oldOnly: true },
  { key: "80CCD2", label: "80CCD(2) — employer NPS contribution", hint: "Allowed under both regimes" },
  { key: "80D", label: "80D — health insurance premium", hint: "Cap ₹25,000 (₹50,000 for senior citizens)", oldOnly: true },
  { key: "HRA_RENT", label: "Annual rent paid", hint: "Used to compute the HRA exemption below" , oldOnly: true },
  { key: "HRA_EXEMPT", label: "HRA exemption claimed", hint: "Least of: HRA received, rent − 10% basic, 40/50% of basic", oldOnly: true },
  { key: "24B", label: "24(b) — home-loan interest (self-occupied)", hint: "Cap ₹2,00,000", oldOnly: true },
  { key: "80G", label: "80G — donations", hint: "Eligible amount as per receipt", oldOnly: true },
  { key: "80TTA", label: "80TTA — savings account interest", hint: "Cap ₹10,000", oldOnly: true },
];

export function TaxDeclarationForm({ fy, declaration, projection }: { fy: string; declaration: DeclarationDto | null; projection: TaxProjection | null }) {
  const router = useRouter();
  const [regime, setRegime] = useState<"NEW" | "OLD">(declaration?.regime ?? projection?.selectedRegime ?? "NEW");
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(Object.entries(declaration?.declarations ?? {}).map(([k, v]) => [k, String(v)])));
  const [busy, setBusy] = useState<string | null>(null);
  const locked = declaration?.status === "SUBMITTED" || declaration?.status === "VERIFIED";

  const body = () => ({ financialYear: fy, regime, declarations: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== "" && Number(v) > 0).map(([k, v]) => [k, Number(v)])) });

  async function save(andSubmit: boolean) {
    setBusy(andSubmit ? "submit" : "save");
    try {
      const d = await apiFetch<DeclarationDto>("/api/v1/tax/declarations", { method: "POST", body: body() });
      if (andSubmit) await apiFetch(`/api/v1/tax/declarations/${d.id}/submit`, { method: "POST" });
      toast.success(andSubmit ? "Declaration submitted for verification" : "Draft saved");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Investment declaration FY {fy}</CardTitle>
          {declaration && <StatusBadge status={declaration.status} />}
        </CardHeader>
        <CardContent className="space-y-4">
          {declaration?.status === "REJECTED" && declaration.note && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">Rejected: {declaration.note}</div>}
          {declaration?.status === "VERIFIED" && declaration.note && <div className="rounded-lg border p-3 text-sm text-muted-foreground">Verifier note: {declaration.note}</div>}
          <div>
            <Label className="mb-2">Tax regime</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["NEW", "OLD"] as const).map((r) => (
                <button key={r} type="button" disabled={locked} onClick={() => setRegime(r)} className={cn("rounded-lg border p-3 text-left text-sm transition-colors", regime === r ? "border-primary bg-primary/5" : "hover:bg-muted", locked && "cursor-not-allowed opacity-70")}>
                  <div className="font-medium">{r === "NEW" ? "New regime" : "Old regime"}</div>
                  <div className="text-xs text-muted-foreground">{r === "NEW" ? "Lower slabs, ₹75k standard deduction, no 80C/80D" : "Classic slabs with Chapter VI-A deductions"}</div>
                  {projection && <div className="mt-1 text-xs">Projected tax: <span className="font-medium">{fmtMoney(projection[r].totalTax)}</span></div>}
                </button>
              ))}
            </div>
            {projection && projection.saving > 0 && <p className="mt-2 text-xs text-muted-foreground">Based on your current salary and declarations, the <b>{projection.recommended}</b> regime saves {fmtMoney(projection.saving)} this year.</p>}
          </div>
          <div className="grid gap-3">
            {SECTIONS.filter((s) => regime === "OLD" || !s.oldOnly).map((s) => (
              <div key={s.key} className="grid gap-1 sm:grid-cols-[1fr_180px] sm:items-center">
                <div>
                  <Label htmlFor={`d-${s.key}`} className="font-normal">{s.label}</Label>
                  <div className="text-xs text-muted-foreground">{s.hint}</div>
                </div>
                <Input id={`d-${s.key}`} type="number" min={0} step="1" value={values[s.key] ?? ""} disabled={locked} placeholder="0" onChange={(e) => setValues({ ...values, [s.key]: e.target.value })} />
              </div>
            ))}
            {regime === "NEW" && <p className="text-xs text-muted-foreground">Most deductions do not apply under the new regime; switch to the old regime to declare 80C, 80D, HRA and home-loan interest.</p>}
          </div>
          {!locked && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => save(false)} disabled={busy !== null}>{busy === "save" ? "Saving…" : "Save draft"}</Button>
              <Button onClick={() => save(true)} disabled={busy !== null}>{busy === "submit" ? "Submitting…" : "Submit for verification"}</Button>
            </div>
          )}
          {locked && <p className="text-xs text-muted-foreground">Submitted declarations are locked. Contact payroll if you need to change it.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Regime comparison</CardTitle></CardHeader>
        <CardContent>
          {!projection ? (
            <p className="text-sm text-muted-foreground">No current salary on file.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-muted-foreground"><th className="text-left font-medium">FY {projection.financialYear}</th><th className="text-right font-medium">New</th><th className="text-right font-medium">Old</th></tr></thead>
              <tbody className="[&_td]:py-1 [&_td:not(:first-child)]:text-right [&_td:not(:first-child)]:tabular-nums">
                <tr><td>Taxable salary</td><td>{fmtMoney(projection.NEW.grossSalary)}</td><td>{fmtMoney(projection.OLD.grossSalary)}</td></tr>
                <tr><td>Standard deduction</td><td>−{fmtMoney(projection.NEW.standardDeduction)}</td><td>−{fmtMoney(projection.OLD.standardDeduction)}</td></tr>
                <tr><td>Other deductions</td><td>−{fmtMoney(projection.NEW.deductions)}</td><td>−{fmtMoney(projection.OLD.deductions)}</td></tr>
                <tr className="border-t font-medium"><td>Taxable income</td><td>{fmtMoney(projection.NEW.taxableIncome)}</td><td>{fmtMoney(projection.OLD.taxableIncome)}</td></tr>
                <tr><td>Tax on slabs</td><td>{fmtMoney(projection.NEW.slabTax)}</td><td>{fmtMoney(projection.OLD.slabTax)}</td></tr>
                <tr><td>Rebate 87A</td><td>−{fmtMoney(projection.NEW.rebate)}</td><td>−{fmtMoney(projection.OLD.rebate)}</td></tr>
                <tr><td>Surcharge</td><td>{fmtMoney(projection.NEW.surcharge)}</td><td>{fmtMoney(projection.OLD.surcharge)}</td></tr>
                <tr><td>Cess 4%</td><td>{fmtMoney(projection.NEW.cess)}</td><td>{fmtMoney(projection.OLD.cess)}</td></tr>
                <tr className="border-t font-semibold"><td>Total tax</td><td>{fmtMoney(projection.NEW.totalTax)}</td><td>{fmtMoney(projection.OLD.totalTax)}</td></tr>
                <tr className="text-muted-foreground"><td>Monthly TDS</td><td>{fmtMoney(projection.NEW.monthlyTds)}</td><td>{fmtMoney(projection.OLD.monthlyTds)}</td></tr>
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-muted-foreground">Projection assumes your current monthly salary for the full year. Employee PF ({projection ? fmtMoney(projection.pfAnnual) : "—"}) and professional tax are included for the old regime.</p>
        </CardContent>
      </Card>
    </div>
  );
}
