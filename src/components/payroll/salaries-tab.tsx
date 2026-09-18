"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/common/native-select";
import { apiFetch } from "@/lib/client/api";
import { fmtDate, fmtMoney, isoDate, todayUtc } from "@/lib/dates";
import type { Page } from "@/lib/api";
import type { SalaryDto, StructureDto } from "@/server/services/payroll";
import { EmployeePicker, type PickedEmployee } from "./employee-picker";
import { Pager } from "./pager";

export interface SalaryListRow { employeeCode: string; displayName: string; department: string | null; designation: string | null }
type Preview = { lines: { code: string; name: string; type: string; monthly: number; annual: number }[]; monthlyCtc: number };
type History = { employee: { id: string; employeeCode: string; displayName: string }; current: SalaryDto | null; history: SalaryDto[] };

export function SalariesTab({ salaries, structures, query }: { salaries: Page<SalaryDto & SalaryListRow>; structures: StructureDto[]; query: { q: string; page: number } }) {
  const router = useRouter();
  const [search, setSearch] = useState(query.q);
  const [open, setOpen] = useState(false);
  const [emp, setEmp] = useState<PickedEmployee | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [form, setForm] = useState({ structureId: structures.find((s) => s.isDefault)?.id ?? structures[0]?.id ?? "", annualCtc: "", effectiveFrom: isoDate(todayUtc()), pfApplicable: true, esiApplicable: false, ptApplicable: true, taxRegime: "NEW", note: "" });

  function openFor(e: PickedEmployee | null) {
    setEmp(e);
    setHistory(null);
    setOpen(true);
  }
  useEffect(() => {
    if (!emp) return;
    apiFetch<History>(`/api/v1/payroll/salaries/${emp.id}`).then((h) => {
      setHistory(h);
      if (h.current) setForm((f) => ({ ...f, structureId: h.current!.structureId ?? f.structureId, annualCtc: String(h.current!.annualCtc), pfApplicable: h.current!.pfApplicable, esiApplicable: h.current!.esiApplicable, ptApplicable: h.current!.ptApplicable, taxRegime: h.current!.taxRegime }));
    }).catch(() => setHistory(null));
  }, [emp]);
  useEffect(() => {
    const ctc = Number(form.annualCtc);
    const t = setTimeout(() => !form.structureId || !ctc ? setPreview(null) : apiFetch<Preview>("/api/v1/payroll/structures/preview", { method: "POST", body: { structureId: form.structureId, annualCtc: ctc } }).then(setPreview).catch(() => setPreview(null)), 300);
    return () => clearTimeout(t);
  }, [form.structureId, form.annualCtc]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!emp) return toast.error("Pick an employee");
    setBusy(true);
    try {
      await apiFetch("/api/v1/payroll/salaries", { method: "POST", body: { employeeId: emp.id, ...form, annualCtc: Number(form.annualCtc), note: form.note || undefined } });
      toast.success(history?.current ? "Salary revised" : "Salary assigned");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }
  function goSearch(e: React.FormEvent) {
    e.preventDefault();
    router.push(`/payroll/setup?tab=salaries${search ? `&q=${encodeURIComponent(search)}` : ""}`);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <form onSubmit={goSearch} className="flex max-w-sm flex-1 gap-2">
          <Input placeholder="Search name, code or email" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Button type="submit" variant="outline" size="icon" aria-label="Search"><Search /></Button>
        </form>
        <Button size="sm" onClick={() => openFor(null)}><Plus /> Assign / revise salary</Button>
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Structure</TableHead>
              <TableHead className="text-right">Annual CTC</TableHead>
              <TableHead className="text-right">Monthly gross</TableHead>
              <TableHead>Regime</TableHead>
              <TableHead>Effective</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {salaries.items.map((s) => (
              <TableRow key={s.id} className="cursor-pointer" onClick={() => openFor({ id: s.employeeId, employeeCode: s.employeeCode, displayName: s.displayName, department: s.department ? { name: s.department } : null, designation: s.designation ? { name: s.designation } : null })}>
                <TableCell><div className="font-medium">{s.displayName}</div><div className="text-xs text-muted-foreground">{s.employeeCode} · {s.designation ?? "—"}</div></TableCell>
                <TableCell className="text-muted-foreground">{s.department ?? "—"}</TableCell>
                <TableCell>{s.structureName ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtMoney(s.annualCtc)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtMoney(Object.values(s.monthly).reduce((a, b) => a + b, 0))}</TableCell>
                <TableCell>{s.taxRegime}</TableCell>
                <TableCell>{fmtDate(s.effectiveFrom)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pager page={salaries.page} pages={salaries.pages} total={salaries.total} basePath="/payroll/setup" params={{ tab: "salaries", q: query.q || undefined }} />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <form onSubmit={save} className="contents">
            <DialogHeader>
              <DialogTitle>{history?.current ? "Revise salary" : "Assign salary"}</DialogTitle>
              <DialogDescription>The previous salary is kept in history; a revision also records a job-history entry.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 md:grid-cols-[1fr_260px]">
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label>Employee</Label>
                  <EmployeePicker value={emp} onChange={(e) => { setEmp(e); setHistory(null); }} />
                  {history?.current && <p className="text-xs text-muted-foreground">Current: {fmtMoney(history.current.annualCtc)} p.a. since {fmtDate(history.current.effectiveFrom)}</p>}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="sal-structure">Structure</Label>
                    <NativeSelect id="sal-structure" value={form.structureId} onChange={(e) => setForm({ ...form, structureId: e.target.value })}>
                      {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </NativeSelect>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="sal-ctc">Annual CTC (₹)</Label>
                    <Input id="sal-ctc" type="number" min={1} step="1000" value={form.annualCtc} onChange={(e) => setForm({ ...form, annualCtc: e.target.value })} required />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="sal-from">Effective from</Label>
                    <Input id="sal-from" type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} required />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="sal-regime">Tax regime</Label>
                    <NativeSelect id="sal-regime" value={form.taxRegime} onChange={(e) => setForm({ ...form, taxRegime: e.target.value })}>
                      <option value="NEW">New regime</option>
                      <option value="OLD">Old regime</option>
                    </NativeSelect>
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 text-sm">
                  <Label className="gap-2 font-normal"><Checkbox checked={form.pfApplicable} onCheckedChange={(v) => setForm({ ...form, pfApplicable: Boolean(v) })} /> PF</Label>
                  <Label className="gap-2 font-normal"><Checkbox checked={form.esiApplicable} onCheckedChange={(v) => setForm({ ...form, esiApplicable: Boolean(v) })} /> ESI</Label>
                  <Label className="gap-2 font-normal"><Checkbox checked={form.ptApplicable} onCheckedChange={(v) => setForm({ ...form, ptApplicable: Boolean(v) })} /> Professional tax</Label>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="sal-note">Note</Label>
                  <Input id="sal-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. Annual appraisal 2026" />
                </div>
                {history && history.history.length > 1 && (
                  <div>
                    <div className="mb-1 text-xs font-medium text-muted-foreground">History</div>
                    <ul className="divide-y rounded-lg border text-xs">
                      {history.history.map((h) => (
                        <li key={h.id} className="flex justify-between px-2 py-1"><span>{fmtDate(h.effectiveFrom)} · {h.structureName ?? "—"}{h.isCurrent ? " (current)" : ""}</span><span className="tabular-nums">{fmtMoney(h.annualCtc)}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="rounded-lg bg-muted/40 p-3 text-sm">
                <div className="mb-2 text-xs font-medium text-muted-foreground">Monthly breakdown</div>
                {preview ? (
                  <ul className="divide-y">
                    {preview.lines.map((l) => <li key={l.code} className="flex justify-between py-1"><span>{l.name}</span><span className="tabular-nums">{fmtMoney(l.monthly)}</span></li>)}
                    <li className="flex justify-between py-1 font-medium"><span>Monthly CTC</span><span className="tabular-nums">{fmtMoney(preview.monthlyCtc)}</span></li>
                  </ul>
                ) : <p className="text-xs text-muted-foreground">Enter a CTC to preview.</p>}
              </div>
            </div>
            <DialogFooter showCloseButton>
              <Button type="submit" disabled={busy || !emp}>{busy ? "Saving…" : "Save salary"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
