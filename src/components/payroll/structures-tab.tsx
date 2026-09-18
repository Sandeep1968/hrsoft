"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/common/native-select";
import { apiFetch } from "@/lib/client/api";
import { fmtMoney } from "@/lib/dates";
import type { StructureDto } from "@/server/services/payroll";
import type { ComponentRow } from "./components-tab";

type CalcType = "FIXED" | "PERCENT_OF_BASIC" | "PERCENT_OF_GROSS" | "PERCENT_OF_CTC" | "BALANCE";
interface LineDraft { componentId: string; calcType: CalcType; value: number }
interface Draft { id?: string; name: string; description: string; isDefault: boolean; lines: LineDraft[] }
type Preview = { monthly: Record<string, number>; lines: { code: string; name: string; type: string; monthly: number; annual: number }[]; monthlyCtc: number };

const CALC_LABEL: Record<CalcType, string> = { FIXED: "Fixed amount", PERCENT_OF_CTC: "% of CTC", PERCENT_OF_BASIC: "% of Basic", PERCENT_OF_GROSS: "% of gross so far", BALANCE: "Balance of CTC" };

export function StructuresTab({ structures, components }: { structures: StructureDto[]; components: ComponentRow[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [sampleCtc, setSampleCtc] = useState(1_200_000);
  const [preview, setPreview] = useState<Preview | null>(null);
  const compById = useMemo(() => new Map(components.map((c) => [c.id, c])), [components]);

  // Live preview: debounce posting the draft lines to the preview endpoint.
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!draft || draft.lines.length === 0 || !sampleCtc) {
        setPreview(null);
        return;
      }
      try {
        setPreview(await apiFetch<Preview>("/api/v1/payroll/structures/preview", { method: "POST", body: { annualCtc: sampleCtc, lines: draft.lines.map((l, i) => ({ ...l, order: i + 1 })) } }));
      } catch {
        setPreview(null);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [draft, sampleCtc]);

  function edit(s: StructureDto) {
    setDraft({ id: s.id, name: s.name, description: s.description ?? "", isDefault: s.isDefault, lines: s.lines.map((l) => ({ componentId: l.componentId, calcType: l.calcType, value: l.value })) });
  }
  function fresh() {
    const basic = components.find((c) => c.code === "BASIC");
    setDraft({ name: "", description: "", isDefault: false, lines: basic ? [{ componentId: basic.id, calcType: "PERCENT_OF_CTC", value: 40 }] : [] });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    try {
      const body = { name: draft.name, description: draft.description || null, isDefault: draft.isDefault, lines: draft.lines.map((l, i) => ({ ...l, order: i + 1 })) };
      if (draft.id) await apiFetch(`/api/v1/payroll/structures/${draft.id}`, { method: "PATCH", body });
      else await apiFetch("/api/v1/payroll/structures", { method: "POST", body });
      toast.success("Structure saved");
      setDraft(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }
  async function remove(s: StructureDto) {
    if (!confirm(`Delete structure "${s.name}"?`)) return;
    try {
      await apiFetch(`/api/v1/payroll/structures/${s.id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete");
    }
  }
  const setLine = (i: number, patch: Partial<LineDraft>) => draft && setDraft({ ...draft, lines: draft.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const move = (i: number, dir: -1 | 1) => {
    if (!draft) return;
    const j = i + dir;
    if (j < 0 || j >= draft.lines.length) return;
    const lines = [...draft.lines];
    [lines[i], lines[j]] = [lines[j], lines[i]];
    setDraft({ ...draft, lines });
  };
  const unused = components.filter((c) => !draft?.lines.some((l) => l.componentId === c.id) && !c.isStatutory);

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={fresh}><Plus /> New structure</Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {structures.map((s) => (
          <Card key={s.id}>
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle className="text-base">{s.name} {s.isDefault && <span className="ml-1 rounded bg-primary/10 px-1.5 text-[10px] uppercase text-primary">Default</span>}</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">{s.description || `${s.lines.length} lines`} · {s.salaryCount.toLocaleString("en-IN")} employees</p>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => edit(s)}><Pencil /></Button>
                <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={() => remove(s)} disabled={s.salaryCount > 0}><Trash2 /></Button>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {s.lines.map((l) => (
                  <li key={l.id} className="flex items-center justify-between py-1.5">
                    <span>{l.name} <span className="text-xs text-muted-foreground">({l.code})</span></span>
                    <span className="text-muted-foreground">{l.calcType === "BALANCE" ? "Balance" : l.calcType === "FIXED" ? fmtMoney(l.value) : `${l.value}% ${CALC_LABEL[l.calcType].replace("% ", "")}`}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-3xl">
          {draft && (
            <form onSubmit={save} className="contents">
              <DialogHeader>
                <DialogTitle>{draft.id ? "Edit structure" : "New structure"}</DialogTitle>
                <DialogDescription>Lines are evaluated top to bottom; a BALANCE line absorbs whatever CTC remains.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 md:grid-cols-[1fr_280px]">
                <div className="grid gap-3">
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <div className="grid gap-1.5">
                      <Label htmlFor="s-name">Name</Label>
                      <Input id="s-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
                    </div>
                    <Label className="mt-5 gap-2 font-normal"><Checkbox checked={draft.isDefault} onCheckedChange={(v) => setDraft({ ...draft, isDefault: Boolean(v) })} /> Default</Label>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="s-desc">Description</Label>
                    <Input id="s-desc" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                  </div>
                  <div className="rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Component</TableHead>
                          <TableHead>Calculation</TableHead>
                          <TableHead className="w-28">Value</TableHead>
                          <TableHead className="w-24" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {draft.lines.map((l, i) => (
                          <TableRow key={l.componentId}>
                            <TableCell>{compById.get(l.componentId)?.name ?? "?"} <span className="text-xs text-muted-foreground">{compById.get(l.componentId)?.code}</span></TableCell>
                            <TableCell>
                              <NativeSelect value={l.calcType} onChange={(e) => setLine(i, { calcType: e.target.value as CalcType })}>
                                {(Object.keys(CALC_LABEL) as CalcType[]).map((k) => <option key={k} value={k}>{CALC_LABEL[k]}</option>)}
                              </NativeSelect>
                            </TableCell>
                            <TableCell><Input type="number" min={0} step="0.01" value={l.value} disabled={l.calcType === "BALANCE"} onChange={(e) => setLine(i, { value: Number(e.target.value) })} /></TableCell>
                            <TableCell className="whitespace-nowrap">
                              <Button type="button" variant="ghost" size="icon-xs" aria-label="Up" onClick={() => move(i, -1)}><ArrowUp /></Button>
                              <Button type="button" variant="ghost" size="icon-xs" aria-label="Down" onClick={() => move(i, 1)}><ArrowDown /></Button>
                              <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove" onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, j) => j !== i) })}><Trash2 /></Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {unused.length > 0 && (
                    <NativeSelect value="" onChange={(e) => e.target.value && setDraft({ ...draft, lines: [...draft.lines, { componentId: e.target.value, calcType: "FIXED", value: 0 }] })}>
                      <option value="">+ Add component…</option>
                      {unused.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
                    </NativeSelect>
                  )}
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <Label htmlFor="sample" className="text-xs">Preview for annual CTC</Label>
                  <Input id="sample" className="mt-1 mb-3" type="number" min={0} step="10000" value={sampleCtc} onChange={(e) => setSampleCtc(Number(e.target.value))} />
                  {preview ? (
                    <ul className="divide-y text-sm">
                      {preview.lines.map((l) => (
                        <li key={l.code} className="flex justify-between py-1"><span>{l.name}</span><span className="tabular-nums">{fmtMoney(l.monthly)}</span></li>
                      ))}
                      <li className="flex justify-between py-1 font-medium"><span>Monthly CTC</span><span className="tabular-nums">{fmtMoney(preview.monthlyCtc)}</span></li>
                      <li className="flex justify-between py-1 text-xs text-muted-foreground"><span>Sum of earnings</span><span className="tabular-nums">{fmtMoney(preview.lines.filter((l) => l.type === "EARNING" || l.type === "REIMBURSEMENT").reduce((a, l) => a + l.monthly, 0))}</span></li>
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">Add lines to see the breakdown.</p>
                  )}
                </div>
              </div>
              <DialogFooter showCloseButton>
                <Button type="submit" disabled={busy || draft.lines.length === 0}>{busy ? "Saving…" : "Save structure"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
