"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/common/native-select";
import { StatusBadge } from "@/components/common";
import { apiFetch } from "@/lib/client/api";
import { fmtDateTime, fmtMoney } from "@/lib/dates";
import type { DeclarationDto } from "@/server/services/payroll";

const LABELS: Record<string, string> = { "80C": "80C investments", "80CCD1B": "80CCD(1B) NPS", "80CCD2": "80CCD(2) employer NPS", "80D": "80D health insurance", HRA_RENT: "Annual rent paid", HRA_EXEMPT: "HRA exemption", "24B": "24(b) home-loan interest", "80G": "80G donations", "80TTA": "80TTA savings interest" };

export function DeclarationQueue({ items, fy, fys, status, q }: { items: DeclarationDto[]; fy: string; fys: string[]; status: string; q: string }) {
  const router = useRouter();
  const [search, setSearch] = useState(q);
  const [sel, setSel] = useState<DeclarationDto | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const go = (next: Partial<{ fy: string; status: string; q: string }>) => {
    const p = new URLSearchParams({ fy: next.fy ?? fy, status: next.status ?? status });
    const qq = next.q ?? q;
    if (qq) p.set("q", qq);
    router.push(`/payroll/tax?${p}`);
  };
  async function decide(decision: "VERIFIED" | "REJECTED") {
    if (!sel) return;
    if (decision === "REJECTED" && !note.trim()) return toast.error("Add a note explaining the rejection");
    setBusy(true);
    try {
      await apiFetch(`/api/v1/tax/declarations/${sel.id}/verify`, { method: "POST", body: { decision, note: note || undefined } });
      toast.success(decision === "VERIFIED" ? "Declaration verified" : "Declaration rejected");
      setSel(null);
      setNote("");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  const total = (d: DeclarationDto) => Object.entries(d.declarations).filter(([k]) => k !== "HRA_RENT").reduce((a, [, v]) => a + v, 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <NativeSelect className="w-32" value={fy} onChange={(e) => go({ fy: e.target.value })} aria-label="Financial year">
          {fys.map((f) => <option key={f} value={f}>FY {f}</option>)}
        </NativeSelect>
        <NativeSelect className="w-36" value={status} onChange={(e) => go({ status: e.target.value })} aria-label="Status">
          <option value="ALL">All statuses</option>
          {["DRAFT", "SUBMITTED", "VERIFIED", "REJECTED"].map((s) => <option key={s} value={s}>{s}</option>)}
        </NativeSelect>
        <form onSubmit={(e) => { e.preventDefault(); go({ q: search }); }} className="flex max-w-xs flex-1 gap-2">
          <Input placeholder="Search employee" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Button type="submit" variant="outline" size="icon" aria-label="Search"><Search /></Button>
        </form>
      </div>
      {items.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Regime</TableHead>
                <TableHead className="text-right">Declared</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((d) => (
                <TableRow key={d.id}>
                  <TableCell><div className="font-medium">{d.displayName}</div><div className="text-xs text-muted-foreground">{d.employeeCode}</div></TableCell>
                  <TableCell className="text-muted-foreground">{d.department ?? "—"}</TableCell>
                  <TableCell>{d.regime}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(total(d))}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDateTime(d.submittedAt)}</TableCell>
                  <TableCell><StatusBadge status={d.status} /></TableCell>
                  <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => { setSel(d); setNote(d.note ?? ""); }}>{d.status === "SUBMITTED" ? "Verify" : "View"}</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Dialog open={sel !== null} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent className="sm:max-w-lg">
          {sel && (
            <>
              <DialogHeader>
                <DialogTitle>{sel.displayName} · FY {sel.financialYear}</DialogTitle>
                <DialogDescription>{sel.regime} regime · <StatusBadge status={sel.status} /></DialogDescription>
              </DialogHeader>
              <table className="w-full text-sm">
                <tbody className="divide-y">
                  {Object.entries(sel.declarations).map(([k, v]) => (
                    <tr key={k}><td className="py-1.5">{LABELS[k] ?? k}</td><td className="py-1.5 text-right tabular-nums">{fmtMoney(v)}</td></tr>
                  ))}
                  {Object.keys(sel.declarations).length === 0 && <tr><td className="py-2 text-muted-foreground">Nothing declared.</td></tr>}
                </tbody>
              </table>
              <div className="grid gap-1.5">
                <Label htmlFor="v-note">Note {sel.status === "SUBMITTED" && <span className="text-xs text-muted-foreground">(required when rejecting)</span>}</Label>
                <Textarea id="v-note" value={note} onChange={(e) => setNote(e.target.value)} disabled={sel.status !== "SUBMITTED"} placeholder="e.g. LIC receipt missing for 80C" />
              </div>
              <DialogFooter showCloseButton>
                {sel.status === "SUBMITTED" && (
                  <>
                    <Button variant="destructive" onClick={() => decide("REJECTED")} disabled={busy}>Reject</Button>
                    <Button onClick={() => decide("VERIFIED")} disabled={busy}>Verify</Button>
                  </>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
