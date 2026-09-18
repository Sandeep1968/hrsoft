"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/common/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch, ApiError } from "@/lib/client/api";

interface ColumnDef { key: string; label: string; group: string }
interface Lookups { departments: { id: string; name: string }[]; locations: { id: string; name: string }[] }
interface Result { items: Record<string, unknown>[]; total: number; page: number; pages: number; columns: string[] }

const DEFAULT_COLS = ["employeeCode", "displayName", "department", "designation", "joiningDate", "status"];

export function CustomBuilder({ columns, lookups, canExport }: { columns: ColumnDef[]; lookups: Lookups; canExport: boolean }) {
  const [cols, setCols] = useState<string[]>(DEFAULT_COLS);
  const [filters, setFilters] = useState({ departmentId: "", locationId: "", status: "", employmentType: "", gender: "", joinedFrom: "", joinedTo: "", q: "" });
  const [sort, setSort] = useState("employeeCode");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const groups = [...new Set(columns.map((c) => c.group))];

  function body(page: number) {
    const f: Record<string, string> = {};
    for (const [k, v] of Object.entries(filters)) if (v) f[k] = v;
    return { entity: "employees", columns: cols, filters: f, sort, order: "asc", page, pageSize: 50 };
  }
  async function run(page = 1) {
    if (cols.length === 0) return toast.error("Pick at least one column");
    setBusy(true);
    try {
      setResult(await apiFetch<Result>("/api/v1/reports/custom", { method: "POST", body: body(page) }));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not run report");
    } finally {
      setBusy(false);
    }
  }
  async function exportCsv() {
    setBusy(true);
    try {
      const res = await fetch("/api/v1/reports/custom?format=csv", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body(1)) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error?.message ?? "Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `employees-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }
  const toggle = (k: string) => setCols((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));
  const set = (k: keyof typeof filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const fmt = (v: unknown) => (v === null || v === undefined ? "—" : String(v).replaceAll("_", " "));

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <aside className="space-y-4 rounded-lg border p-3 text-sm">
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Columns</div>
          {groups.map((g) => (
            <div key={g} className="mb-2">
              <div className="mb-1 text-xs text-muted-foreground">{g}</div>
              <div className="grid gap-1">
                {columns.filter((c) => c.group === g).map((c) => (
                  <label key={c.key} className="flex items-center gap-2"><Checkbox checked={cols.includes(c.key)} onCheckedChange={() => toggle(c.key)} /> {c.label}</label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="grid gap-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Filters</div>
          <Label className="grid gap-1 text-xs">Search<Input value={filters.q} onChange={(e) => set("q", e.target.value)} placeholder="Name, code or email" /></Label>
          <Label className="grid gap-1 text-xs">Department<NativeSelect value={filters.departmentId} onChange={(e) => set("departmentId", e.target.value)}><option value="">Any</option>{lookups.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</NativeSelect></Label>
          <Label className="grid gap-1 text-xs">Location<NativeSelect value={filters.locationId} onChange={(e) => set("locationId", e.target.value)}><option value="">Any</option>{lookups.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</NativeSelect></Label>
          <Label className="grid gap-1 text-xs">Status<NativeSelect value={filters.status} onChange={(e) => set("status", e.target.value)}><option value="">Any</option>{["ONBOARDING", "ACTIVE", "ON_NOTICE", "EXITED"].map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</NativeSelect></Label>
          <Label className="grid gap-1 text-xs">Employment type<NativeSelect value={filters.employmentType} onChange={(e) => set("employmentType", e.target.value)}><option value="">Any</option>{["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN", "CONSULTANT"].map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</NativeSelect></Label>
          <Label className="grid gap-1 text-xs">Gender<NativeSelect value={filters.gender} onChange={(e) => set("gender", e.target.value)}><option value="">Any</option>{["MALE", "FEMALE", "OTHER", "UNDISCLOSED"].map((s) => <option key={s} value={s}>{s}</option>)}</NativeSelect></Label>
          <div className="grid grid-cols-2 gap-2">
            <Label className="grid gap-1 text-xs">Joined from<Input type="date" value={filters.joinedFrom} onChange={(e) => set("joinedFrom", e.target.value)} /></Label>
            <Label className="grid gap-1 text-xs">Joined to<Input type="date" value={filters.joinedTo} onChange={(e) => set("joinedTo", e.target.value)} /></Label>
          </div>
          <Label className="grid gap-1 text-xs">Sort by<NativeSelect value={sort} onChange={(e) => setSort(e.target.value)}><option value="employeeCode">Employee code</option><option value="displayName">Name</option><option value="joiningDate">Joining date</option></NativeSelect></Label>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => run(1)} disabled={busy} className="flex-1"><Play /> Run</Button>
          {canExport && <Button variant="outline" onClick={exportCsv} disabled={busy || cols.length === 0}><Download /> CSV</Button>}
        </div>
      </aside>
      <div className="min-w-0">
        {result === null ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">Choose columns and filters, then run the report.</div>
        ) : (
          <div className="rounded-lg border">
            <div className="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
              <span>{result.total.toLocaleString("en-IN")} employees · page {result.page} of {result.pages}</span>
              <div className="flex gap-1"><Button size="xs" variant="outline" disabled={busy || result.page <= 1} onClick={() => run(result.page - 1)}>Prev</Button><Button size="xs" variant="outline" disabled={busy || result.page >= result.pages} onClick={() => run(result.page + 1)}>Next</Button></div>
            </div>
            <Table>
              <TableHeader><TableRow>{result.columns.map((c) => <TableHead key={c}>{columns.find((x) => x.key === c)?.label ?? c}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {result.items.length === 0 && <TableRow><TableCell colSpan={result.columns.length} className="text-muted-foreground">No employees match.</TableCell></TableRow>}
                {result.items.map((r, i) => <TableRow key={i}>{result.columns.map((c) => <TableCell key={c}>{fmt(r[c])}</TableCell>)}</TableRow>)}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
