"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Download, Lock, Play, RotateCcw, Wallet, ChevronDown, Plus, Trash2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, StatCard, StatusBadge } from "@/components/common";
import { NativeSelect } from "@/components/common/native-select";
import { Checkbox } from "@/components/ui/checkbox";
import { apiFetch } from "@/lib/client/api";
import { fmtMoney, fmtDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { AdjustmentDto, RunDetail as RunDetailDto } from "@/server/services/payroll";
import type { Page } from "@/lib/api";
import { Pager } from "./pager";
import { EmployeePicker, type PickedEmployee } from "./employee-picker";

type PayslipRow = { id: string; employeeId: string; employeeCode: string; displayName: string; department: string | null; gross: number; totalDeductions: number; netPay: number; lopDays: number; payableDays: number; tds: number; pfEmployee: number };

const STEPS = ["DRAFT", "PROCESSING", "REVIEW", "FINALIZED", "PAID"] as const;

export function RunDetail({ run: initial, payslips, adjustments, query, perms }: { run: RunDetailDto; payslips: Page<PayslipRow>; adjustments: AdjustmentDto[]; query: { q: string; page: number; tab: string }; perms: { run: boolean; finalize: boolean; sensitive: boolean } }) {
  const router = useRouter();
  const [run, setRun] = useState(initial);
  const [seen, setSeen] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [paymentRef, setPaymentRef] = useState("");
  const [search, setSearch] = useState(query.q);

  // Adopt fresh server data after router.refresh() (derive-from-props pattern).
  if (seen !== initial) {
    setSeen(initial);
    setRun(initial);
  }

  // Poll while processing; refresh the server-rendered tables once it settles.
  useEffect(() => {
    if (run.status !== "PROCESSING") return;
    const t = setInterval(async () => {
      try {
        const next = await apiFetch<RunDetailDto>(`/api/v1/payroll/runs/${run.id}`);
        setRun(next);
        if (next.status !== "PROCESSING") router.refresh();
      } catch {
        /* keep polling */
      }
    }, 2000);
    return () => clearInterval(t);
  }, [run.status, run.id, router]);

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  const process = () =>
    act("process", async () => {
      const next = await apiFetch<RunDetailDto>(`/api/v1/payroll/runs/${run.id}/process`, { method: "POST" });
      setRun(next);
      toast.info("Processing started");
    });
  const reopen = () =>
    act("reopen", async () => {
      await apiFetch(`/api/v1/payroll/runs/${run.id}`, { method: "DELETE" });
      toast.success("Run reopened — payslips cleared");
    });
  const finalize = () =>
    act("finalize", async () => {
      if (!confirm(`Finalise ${run.employeeCount.toLocaleString("en-IN")} payslips? Employees will be notified and the run locks.`)) return;
      await apiFetch(`/api/v1/payroll/runs/${run.id}/finalize`, { method: "POST" });
      toast.success("Run finalised and payslips published");
    });
  const pay = () =>
    act("pay", async () => {
      await apiFetch(`/api/v1/payroll/runs/${run.id}/pay`, { method: "POST", body: { paymentRef } });
      setPayOpen(false);
      toast.success("Marked as paid");
    });

  const stepIdx = STEPS.indexOf(run.status);
  const progress = run.employeeCount ? Math.round((run.processedCount / run.employeeCount) * 100) : 0;
  const processed = run.status !== "DRAFT" && run.status !== "PROCESSING";

  function goSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = new URLSearchParams();
    if (search) q.set("q", search);
    q.set("tab", "payslips");
    router.push(`/payroll/runs/${run.id}?${q}`);
  }

  return (
    <div className="space-y-6">
      {/* Stepper */}
      <ol className="flex flex-wrap items-center gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium", i < stepIdx && "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100", i === stepIdx && "border-primary bg-primary text-primary-foreground", i > stepIdx && "text-muted-foreground")}>
              {i < stepIdx ? <Check className="size-3" /> : <span className="size-3 text-center leading-3">{i + 1}</span>}
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </span>
            {i < STEPS.length - 1 && <span className="h-px w-4 bg-border" />}
          </li>
        ))}
      </ol>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        {perms.run && (run.status === "DRAFT" || run.status === "REVIEW") && (
          <Button onClick={process} disabled={busy !== null}>
            <Play /> {run.status === "REVIEW" ? "Re-process" : "Process"}
          </Button>
        )}
        {perms.run && run.status === "REVIEW" && (
          <Button variant="outline" onClick={reopen} disabled={busy !== null}>
            <RotateCcw /> Reopen
          </Button>
        )}
        {perms.finalize && run.status === "REVIEW" && (
          <Button onClick={finalize} disabled={busy !== null}>
            <Lock /> Finalise
          </Button>
        )}
        {perms.finalize && run.status === "FINALIZED" && (
          <Button onClick={() => setPayOpen(true)} disabled={busy !== null}>
            <Wallet /> Mark paid
          </Button>
        )}
        {processed && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>
              <Download /> Export <ChevronDown />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem render={<a href={`/api/v1/payroll/runs/${run.id}/export?type=register`} />}>Payroll register (CSV)</DropdownMenuItem>
              {perms.finalize && <DropdownMenuItem render={<a href={`/api/v1/payroll/runs/${run.id}/export?type=bank`} />}>Bank advice (CSV)</DropdownMenuItem>}
              {perms.sensitive && <DropdownMenuItem render={<a href={`/api/v1/payroll/runs/${run.id}/export?type=pf`} />}>PF ECR (CSV)</DropdownMenuItem>}
              <DropdownMenuItem render={<a href={`/api/v1/payroll/runs/${run.id}/export?type=pt`} />}>Professional tax summary (CSV)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <div className="ml-auto text-xs text-muted-foreground">
          {run.finalizedAt && <span>Finalised {fmtDateTime(run.finalizedAt)}</span>}
          {run.paidAt && <span> · Paid {fmtDateTime(run.paidAt)}</span>}
        </div>
      </div>

      {run.status === "PROCESSING" && (
        <Card>
          <CardContent className="p-4">
            <Progress value={progress}>
              <span className="text-sm font-medium">Processing payslips…</span>
              <span className="ml-auto text-sm text-muted-foreground tabular-nums">{run.processedCount.toLocaleString("en-IN")} / {run.employeeCount.toLocaleString("en-IN")} ({progress}%)</span>
            </Progress>
          </CardContent>
        </Card>
      )}
      {run.status === "DRAFT" && run.notes?.startsWith("Processing failed") && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{run.notes}</div>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Employees" value={run.employeeCount.toLocaleString("en-IN")} hint={`${run.payslipCount.toLocaleString("en-IN")} payslips · ${run.statutory.lopDays} LOP days`} />
        <StatCard label="Gross" value={fmtMoney(run.totalGross)} />
        <StatCard label="Deductions" value={fmtMoney(run.totalDeductions)} hint={`TDS ${fmtMoney(run.statutory.tds)} · PT ${fmtMoney(run.statutory.professionalTax)}`} />
        <StatCard label="Net pay" value={fmtMoney(run.totalNet)} />
        <StatCard label="Employer cost" value={fmtMoney(run.totalEmployerCost)} hint={`PF ${fmtMoney(run.statutory.pfEmployer)} · ESI ${fmtMoney(run.statutory.esiEmployer)}`} />
      </div>

      <Tabs value={query.tab} onValueChange={(v) => router.push(`/payroll/runs/${run.id}?tab=${v}`)}>
        <TabsList>
          <TabsTrigger value="payslips">Payslips</TabsTrigger>
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="adjustments">Adjustments {adjustments.length > 0 && <span className="rounded-full bg-muted px-1.5 text-[10px]">{adjustments.length}</span>}</TabsTrigger>
        </TabsList>

        <TabsContent value="payslips" className="mt-3">
          <form onSubmit={goSearch} className="mb-3 flex max-w-sm gap-2">
            <Input placeholder="Search name or code" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Button type="submit" variant="outline" size="icon" aria-label="Search"><Search /></Button>
          </form>
          {payslips.items.length === 0 ? (
            <EmptyState title={processed ? "No payslips match" : "Not processed yet"} description={processed ? "Try a different search." : "Process the run to generate payslips."} />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead className="text-right">Payable days</TableHead>
                    <TableHead className="text-right">LOP</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">PF</TableHead>
                    <TableHead className="text-right">TDS</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right">Net pay</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payslips.items.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Link href={`/payroll/my/${p.id}`} className="font-medium hover:underline">{p.displayName}</Link>
                        <div className="text-xs text-muted-foreground">{p.employeeCode}</div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{p.department ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.payableDays}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", p.lopDays > 0 && "text-amber-700 dark:text-amber-300")}>{p.lopDays}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(p.gross)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(p.pfEmployee)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(p.tds)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(p.totalDeductions)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{fmtMoney(p.netPay)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <Pager page={payslips.page} pages={payslips.pages} total={payslips.total} basePath={`/payroll/runs/${run.id}`} params={{ q: query.q || undefined, tab: "payslips" }} />
        </TabsContent>

        <TabsContent value="departments" className="mt-3">
          {run.departments.length === 0 ? (
            <EmptyState title="No breakdown yet" description="Department totals appear after processing." />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Department</TableHead>
                    <TableHead className="text-right">Employees</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right">Net pay</TableHead>
                    <TableHead className="text-right">Employer cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {run.departments.map((d) => (
                    <TableRow key={d.department}>
                      <TableCell className="font-medium">{d.department}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.count.toLocaleString("en-IN")}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(d.gross)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(d.deductions)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(d.net)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(d.employerCost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="adjustments" className="mt-3">
          <AdjustmentsTab run={run} adjustments={adjustments} canEdit={perms.run && run.status !== "FINALIZED" && run.status !== "PAID"} />
        </TabsContent>
      </Tabs>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark run as paid</DialogTitle>
            <DialogDescription>Record the bank transfer reference. Every payslip in this run will carry it.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="ref">Payment reference</Label>
            <Input id="ref" value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} placeholder="e.g. NEFT batch 2026-09-30" />
          </div>
          <DialogFooter showCloseButton>
            <Button onClick={pay} disabled={!paymentRef.trim() || busy !== null}>Mark paid</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AdjustmentsTab({ run, adjustments, canEdit }: { run: RunDetailDto; adjustments: AdjustmentDto[]; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emp, setEmp] = useState<PickedEmployee | null>(null);
  const [form, setForm] = useState({ type: "EARNING", code: "BONUS", label: "Bonus", amount: "", isTaxable: true, reason: "" });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!emp) return toast.error("Pick an employee");
    setBusy(true);
    try {
      await apiFetch("/api/v1/payroll/adjustments", { method: "POST", body: { employeeId: emp.id, month: run.month, year: run.year, ...form, amount: Number(form.amount) } });
      toast.success("Adjustment added — re-process the run to apply it");
      setOpen(false);
      setEmp(null);
      setForm({ type: "EARNING", code: "BONUS", label: "Bonus", amount: "", isTaxable: true, reason: "" });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add adjustment");
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (!confirm("Delete this adjustment?")) return;
    try {
      await apiFetch(`/api/v1/payroll/adjustments/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete");
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">One-off earnings or deductions for {run.month}/{run.year}. Re-process the run after changes.</p>
        {canEdit && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus /> Add adjustment
          </Button>
        )}
      </div>
      {adjustments.length === 0 ? (
        <EmptyState title="No adjustments" description="Bonuses, arrears, reimbursements and recoveries for this month appear here." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Label</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Taxable</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {adjustments.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div className="font-medium">{a.displayName}</div>
                    <div className="text-xs text-muted-foreground">{a.employeeCode}</div>
                  </TableCell>
                  <TableCell><StatusBadge status={a.type} /></TableCell>
                  <TableCell>{a.label} <span className="text-xs text-muted-foreground">({a.code})</span></TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(a.amount)}</TableCell>
                  <TableCell>{a.isTaxable ? "Yes" : "No"}</TableCell>
                  <TableCell className="max-w-[240px] truncate text-muted-foreground">{a.reason ?? "—"}</TableCell>
                  <TableCell className="text-right">{canEdit && <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={() => remove(a.id)}><Trash2 /></Button>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={add} className="contents">
            <DialogHeader>
              <DialogTitle>Add adjustment</DialogTitle>
              <DialogDescription>Applied to the employee&apos;s payslip for this month.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label>Employee</Label>
                <EmployeePicker value={emp} onChange={setEmp} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="adj-type">Type</Label>
                  <NativeSelect id="adj-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                    <option value="EARNING">Earning</option>
                    <option value="DEDUCTION">Deduction</option>
                  </NativeSelect>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="adj-code">Code</Label>
                  <Input id="adj-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="BONUS" />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="adj-label">Label</Label>
                <Input id="adj-label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="adj-amount">Amount</Label>
                  <Input id="adj-amount" type="number" min={1} step="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
                </div>
                <Label className="mt-5 gap-2">
                  <Checkbox checked={form.isTaxable} onCheckedChange={(v) => setForm({ ...form, isTaxable: Boolean(v) })} /> Taxable
                </Label>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="adj-reason">Reason</Label>
                <Input id="adj-reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Optional" />
              </div>
            </div>
            <DialogFooter showCloseButton>
              <Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
