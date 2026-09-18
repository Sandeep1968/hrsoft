"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NativeSelect } from "@/components/common/native-select";
import { StatusBadge } from "@/components/common";
import { apiFetch, ApiError } from "@/lib/client/api";
import { fmtDate } from "@/lib/dates";
import { DecideButtons } from "../../approvals/decide-dialog";
import type { LeaveRowDto } from "../leave-requests-table";

export interface LeaveTypeDto { id: string; name: string; code: string; color: string; isPaid: boolean; annualQuota: number; accrualPerMonth: number; carryForwardMax: number; maxConsecutiveDays: number | null; allowHalfDay: boolean; allowNegative: boolean; applicableGender: string | null; minNoticeDays: number; requiresDocAfterDays: number | null; isEncashable: boolean; isActive: boolean }
export interface AdminLeaveRow extends LeaveRowDto { employee: { id: string; displayName: string; employeeCode: string; department: { id: string; name: string } | null } }
interface Opt { id: string; name: string }

function err(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : "Something went wrong");
}

export function LeaveAdminTabs({ types, departments, requests, requestFilters, defaultTab, year }: { types: LeaveTypeDto[]; departments: Opt[]; requests: { items: AdminLeaveRow[]; total: number; page: number; pages: number }; requestFilters: { status?: string; departmentId?: string; q?: string }; defaultTab?: string; year: number }) {
  return (
    <Tabs defaultValue={defaultTab && ["types", "balances", "requests", "yearend"].includes(defaultTab) ? defaultTab : "types"}>
      <TabsList>
        <TabsTrigger value="types">Leave types</TabsTrigger>
        <TabsTrigger value="balances">Balances</TabsTrigger>
        <TabsTrigger value="requests">Requests</TabsTrigger>
        <TabsTrigger value="yearend">Year-end</TabsTrigger>
      </TabsList>
      <TabsContent value="types"><TypesTab types={types} /></TabsContent>
      <TabsContent value="balances"><BalancesTab types={types} year={year} /></TabsContent>
      <TabsContent value="requests"><RequestsTab requests={requests} departments={departments} filters={requestFilters} /></TabsContent>
      <TabsContent value="yearend"><YearEndTab year={year} /></TabsContent>
    </Tabs>
  );
}

// ── Types ────────────────────────────────────────────────────────────────

const emptyType: Omit<LeaveTypeDto, "id"> = { name: "", code: "", color: "#2563eb", isPaid: true, annualQuota: 0, accrualPerMonth: 0, carryForwardMax: 0, maxConsecutiveDays: null, allowHalfDay: true, allowNegative: false, applicableGender: null, minNoticeDays: 0, requiresDocAfterDays: null, isEncashable: false, isActive: true };

function TypesTab({ types }: { types: LeaveTypeDto[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<(Omit<LeaveTypeDto, "id"> & { id?: string }) | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      const { id, ...body } = editing;
      if (id) await apiFetch(`/api/v1/leave-types/${id}`, { method: "PATCH", body });
      else await apiFetch("/api/v1/leave-types", { method: "POST", body });
      toast.success("Leave type saved");
      setEditing(null);
      router.refresh();
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove(t: LeaveTypeDto) {
    if (!confirm(`Delete "${t.name}"? Types already in use are deactivated instead.`)) return;
    try {
      const r = await apiFetch<{ deleted: boolean }>(`/api/v1/leave-types/${t.id}`, { method: "DELETE" });
      toast.success(r.deleted ? "Deleted" : "Deactivated");
      router.refresh();
    } catch (e) {
      err(e);
    }
  }
  const num = (k: keyof typeof emptyType, nullable = false) => (e: React.ChangeEvent<HTMLInputElement>) => setEditing((s) => s && { ...s, [k]: e.target.value === "" && nullable ? null : Number(e.target.value) });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Leave types</CardTitle>
        <Button size="sm" onClick={() => setEditing({ ...emptyType })}><Plus /> New type</Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Type</TableHead><TableHead>Paid</TableHead><TableHead className="text-right">Quota</TableHead><TableHead className="text-right">Accrual / mo</TableHead><TableHead className="text-right">Carry fwd</TableHead><TableHead>Rules</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {types.map((t) => (
              <TableRow key={t.id} className={!t.isActive ? "opacity-50" : undefined}>
                <TableCell><span className="inline-flex items-center gap-2 font-medium"><span className="size-2.5 rounded-full" style={{ background: t.color }} />{t.name} <span className="text-xs text-muted-foreground">{t.code}</span></span></TableCell>
                <TableCell>{t.isPaid ? "Paid" : "Unpaid"}</TableCell>
                <TableCell className="text-right tabular-nums">{t.annualQuota}</TableCell>
                <TableCell className="text-right tabular-nums">{t.accrualPerMonth}</TableCell>
                <TableCell className="text-right tabular-nums">{t.carryForwardMax}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {[t.applicableGender && `${t.applicableGender.toLowerCase()} only`, t.minNoticeDays && `${t.minNoticeDays}d notice`, t.maxConsecutiveDays && `max ${t.maxConsecutiveDays}d`, t.requiresDocAfterDays && `doc > ${t.requiresDocAfterDays}d`, !t.allowHalfDay && "no half day", t.allowNegative && "negative ok", t.isEncashable && "encashable"].filter(Boolean).join(" · ") || "—"}
                </TableCell>
                <TableCell className="text-right"><Button size="xs" variant="ghost" onClick={() => setEditing({ ...t })}>Edit</Button><Button size="icon-xs" variant="ghost" aria-label="Delete" onClick={() => remove(t)}><Trash2 /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          {editing && (
            <>
              <DialogHeader><DialogTitle>{editing.id ? "Edit leave type" : "New leave type"}</DialogTitle></DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5"><Label>Name</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
                <div className="grid gap-1.5"><Label>Code</Label><Input value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} maxLength={10} /></div>
                <div className="grid gap-1.5"><Label>Colour</Label><Input type="color" value={editing.color} onChange={(e) => setEditing({ ...editing, color: e.target.value })} /></div>
                <div className="grid gap-1.5">
                  <Label>Applicable gender</Label>
                  <NativeSelect value={editing.applicableGender ?? ""} onChange={(e) => setEditing({ ...editing, applicableGender: e.target.value || null })}>
                    <option value="">Everyone</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option>
                  </NativeSelect>
                </div>
                <div className="grid gap-1.5"><Label>Annual quota</Label><Input type="number" step="0.5" min={0} value={editing.annualQuota} onChange={num("annualQuota")} /></div>
                <div className="grid gap-1.5"><Label>Accrual per month</Label><Input type="number" step="0.5" min={0} value={editing.accrualPerMonth} onChange={num("accrualPerMonth")} /></div>
                <div className="grid gap-1.5"><Label>Carry-forward max</Label><Input type="number" step="0.5" min={0} value={editing.carryForwardMax} onChange={num("carryForwardMax")} /></div>
                <div className="grid gap-1.5"><Label>Min notice days</Label><Input type="number" min={0} value={editing.minNoticeDays} onChange={num("minNoticeDays")} /></div>
                <div className="grid gap-1.5"><Label>Max consecutive days</Label><Input type="number" min={1} value={editing.maxConsecutiveDays ?? ""} onChange={num("maxConsecutiveDays", true)} placeholder="No limit" /></div>
                <div className="grid gap-1.5"><Label>Document required beyond (days)</Label><Input type="number" min={1} value={editing.requiresDocAfterDays ?? ""} onChange={num("requiresDocAfterDays", true)} placeholder="Never" /></div>
                <label className="flex items-center gap-2 text-sm"><Switch checked={editing.isPaid} onCheckedChange={(c) => setEditing({ ...editing, isPaid: c })} /> Paid leave</label>
                <label className="flex items-center gap-2 text-sm"><Switch checked={editing.allowHalfDay} onCheckedChange={(c) => setEditing({ ...editing, allowHalfDay: c })} /> Allow half day</label>
                <label className="flex items-center gap-2 text-sm"><Switch checked={editing.allowNegative} onCheckedChange={(c) => setEditing({ ...editing, allowNegative: c })} /> Allow negative balance</label>
                <label className="flex items-center gap-2 text-sm"><Switch checked={editing.isEncashable} onCheckedChange={(c) => setEditing({ ...editing, isEncashable: c })} /> Encashable</label>
                <label className="flex items-center gap-2 text-sm"><Switch checked={editing.isActive} onCheckedChange={(c) => setEditing({ ...editing, isActive: c })} /> Active</label>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
                <Button onClick={save} disabled={busy || !editing.name.trim() || !editing.code.trim()}>{busy ? "Saving…" : "Save"}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ── Balances ─────────────────────────────────────────────────────────────

interface BalanceDto { id: string; employeeId: string; leaveTypeId: string; leaveType: { name: string; code: string; color: string }; opening: number; accrued: number; carriedForward: number; adjusted: number; used: number; available: number }

function BalancesTab({ types, year: initialYear }: { types: LeaveTypeDto[]; year: number }) {
  const [code, setCode] = useState("");
  const [year, setYear] = useState(initialYear);
  const [rows, setRows] = useState<BalanceDto[] | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [adjust, setAdjust] = useState({ leaveTypeId: types[0]?.id ?? "", delta: "", reason: "" });
  const [busy, setBusy] = useState(false);

  async function lookup() {
    setBusy(true);
    try {
      const r = await apiFetch<BalanceDto[]>(`/api/v1/leave-balances?employeeCode=${encodeURIComponent(code.trim())}&year=${year}`);
      setRows(r);
      setEmployeeId(r[0]?.employeeId ?? null);
      if (r.length === 0) {
        // Resolve the id anyway so an adjustment can create the first row.
        const rec = await apiFetch<{ employee: { id: string } }>(`/api/v1/attendance/records?employeeCode=${encodeURIComponent(code.trim())}&date=${year}-01-01`);
        setEmployeeId(rec.employee.id);
      }
    } catch (e) {
      setRows(null);
      err(e);
    } finally {
      setBusy(false);
    }
  }
  async function submitAdjust() {
    if (!employeeId) return;
    setBusy(true);
    try {
      await apiFetch("/api/v1/leave-balances", { method: "PATCH", body: { employeeId, leaveTypeId: adjust.leaveTypeId, year, delta: Number(adjust.delta), reason: adjust.reason } });
      toast.success("Balance adjusted");
      setAdjust({ ...adjust, delta: "", reason: "" });
      await lookup();
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Employee balances</CardTitle></CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1"><span className="text-xs text-muted-foreground">Employee code or work email</span><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="EMP0001" className="w-56" onKeyDown={(e) => e.key === "Enter" && lookup()} /></div>
          <div className="grid gap-1"><span className="text-xs text-muted-foreground">Year</span><Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28" /></div>
          <Button onClick={lookup} disabled={busy || !code.trim()}>Look up</Button>
        </div>
        {rows && (
          <>
            <Table>
              <TableHeader><TableRow><TableHead>Type</TableHead><TableHead className="text-right">Opening</TableHead><TableHead className="text-right">Accrued</TableHead><TableHead className="text-right">Carried</TableHead><TableHead className="text-right">Adjusted</TableHead><TableHead className="text-right">Used</TableHead><TableHead className="text-right">Available</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell><span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: b.leaveType.color }} />{b.leaveType.name}</span></TableCell>
                    <TableCell className="text-right tabular-nums">{b.opening}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.accrued}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.carriedForward}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.adjusted}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.used}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{b.available}</TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">No balances for {year}. An adjustment below will create the first row.</TableCell></TableRow>}
              </TableBody>
            </Table>
            <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_120px_2fr_auto] sm:items-end">
              <div className="grid gap-1.5"><Label>Leave type</Label><NativeSelect value={adjust.leaveTypeId} onChange={(e) => setAdjust({ ...adjust, leaveTypeId: e.target.value })}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect></div>
              <div className="grid gap-1.5"><Label>Delta (± days)</Label><Input type="number" step="0.5" value={adjust.delta} onChange={(e) => setAdjust({ ...adjust, delta: e.target.value })} placeholder="+2 or -1.5" /></div>
              <div className="grid gap-1.5"><Label>Reason (audited)</Label><Input value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} placeholder="Comp-off for weekend release" /></div>
              <Button onClick={submitAdjust} disabled={busy || !employeeId || !adjust.delta || Number(adjust.delta) === 0 || adjust.reason.trim().length < 3}>Adjust</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Requests ─────────────────────────────────────────────────────────────

function RequestsTab({ requests, departments, filters }: { requests: { items: AdminLeaveRow[]; total: number; page: number; pages: number }; departments: Opt[]; filters: { status?: string; departmentId?: string; q?: string } }) {
  const router = useRouter();
  const sp = useSearchParams();
  function set(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(sp.toString());
    next.set("tab", "requests");
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.push(`/leave/admin?${next.toString()}`);
  }
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-2">
        <CardTitle>Leave requests <span className="text-sm font-normal text-muted-foreground">({requests.total})</span></CardTitle>
        <div className="flex flex-wrap gap-2">
          <NativeSelect value={filters.status ?? ""} onChange={(e) => set({ status: e.target.value || undefined, page: undefined })} className="w-36">
            <option value="">Any status</option><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="CANCELLED">Cancelled</option>
          </NativeSelect>
          <NativeSelect value={filters.departmentId ?? ""} onChange={(e) => set({ departmentId: e.target.value || undefined, page: undefined })} className="w-44">
            <option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </NativeSelect>
          <Input placeholder="Name or code" defaultValue={filters.q ?? ""} className="w-44" onKeyDown={(e) => e.key === "Enter" && set({ q: (e.target as HTMLInputElement).value || undefined, page: undefined })} />
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Type</TableHead><TableHead>Dates</TableHead><TableHead className="text-right">Days</TableHead><TableHead>Reason</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {requests.items.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No requests match.</TableCell></TableRow>}
            {requests.items.map((r) => (
              <TableRow key={r.id}>
                <TableCell><span className="font-medium">{r.employee.displayName}</span><span className="block text-xs text-muted-foreground">{r.employee.employeeCode} · {r.employee.department?.name ?? "—"}</span></TableCell>
                <TableCell><span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: r.leaveType.color }} />{r.leaveType.code}</span></TableCell>
                <TableCell>{fmtDate(r.startDate)}{r.endDate !== r.startDate ? ` → ${fmtDate(r.endDate)}` : ""}</TableCell>
                <TableCell className="text-right tabular-nums">{r.days}</TableCell>
                <TableCell className="max-w-56 whitespace-normal">{r.reason}{r.decisionNote ? <span className="block text-xs text-muted-foreground">Note: {r.decisionNote}</span> : null}</TableCell>
                <TableCell><StatusBadge status={r.status} /></TableCell>
                <TableCell className="text-right">{r.status === "PENDING" && <DecideButtons size="xs" decideUrl={`/api/v1/leave-requests/${r.id}/decide`} title={`${r.employee.displayName} · ${r.leaveType.name} · ${r.days} day(s)`} />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {requests.pages > 1 && (
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>Page {requests.page} of {requests.pages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={requests.page <= 1} onClick={() => set({ page: String(requests.page - 1) })}>Previous</Button>
              <Button size="sm" variant="outline" disabled={requests.page >= requests.pages} onClick={() => set({ page: String(requests.page + 1) })}>Next</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Year-end ─────────────────────────────────────────────────────────────

function YearEndTab({ year: current }: { year: number }) {
  const [year, setYear] = useState(current);
  const [month, setMonth] = useState(new Date().getUTCMonth() + 1);
  const [busy, setBusy] = useState<"cf" | "accrual" | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function run(job: "carry_forward" | "accrual") {
    if (!confirm(job === "carry_forward" ? `Create ${year + 1} balances with carry-forward from ${year} for every active employee?` : `Recompute accruals for ${year}-${String(month).padStart(2, "0")}?`)) return;
    setBusy(job === "carry_forward" ? "cf" : "accrual");
    try {
      const r = await apiFetch<{ types: { code: string; rows: number }[] }>("/api/v1/leave/jobs", { method: "POST", body: job === "carry_forward" ? { job, year } : { job, year, month } });
      setResult(r.types.map((t) => `${t.code}: ${t.rows} rows`).join(" · "));
      toast.success("Job completed");
    } catch (e) {
      err(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Year-end carry forward</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p className="text-muted-foreground">Creates next year&apos;s balances for every active employee: carried forward = min(available, carry-forward max); opening = annual quota for non-accruing types. Safe to re-run — only the carried-forward figure is updated.</p>
          <div className="grid gap-1.5"><Label>From year</Label><Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-32" /></div>
          <Button onClick={() => run("carry_forward")} disabled={busy !== null}>{busy === "cf" ? "Running…" : `Run carry forward → ${year + 1}`}</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Monthly accrual</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p className="text-muted-foreground">Normally scheduled by cron on the 1st. Sets accrued = rate × months elapsed (from joining month), capped at the annual quota. Idempotent.</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Year</Label><Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} /></div>
            <div className="grid gap-1.5"><Label>Month</Label><Input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))} /></div>
          </div>
          <Button variant="outline" onClick={() => run("accrual")} disabled={busy !== null}>{busy === "accrual" ? "Running…" : "Run accrual"}</Button>
        </CardContent>
      </Card>
      {result && <div className="rounded-lg border bg-muted/40 p-3 text-sm md:col-span-2">Last result: {result}</div>}
    </div>
  );
}

