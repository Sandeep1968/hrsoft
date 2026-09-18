"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/common/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch, ApiError } from "@/lib/client/api";

interface Category { id: string; name: string; slaHours: number; assigneeRoleKey: string | null; ticketCount: number }

export function CategoriesPanel({ categories, roleKeys }: { categories: Category[]; roleKeys: string[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", slaHours: "48", assigneeRoleKey: "" });
  const [busy, setBusy] = useState(false);

  async function call(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <form
        className="mb-3 grid gap-2 sm:grid-cols-[1fr_8rem_12rem_auto]"
        onSubmit={(e) => { e.preventDefault(); void call(() => apiFetch("/api/v1/ticket-categories", { method: "POST", body: { name: form.name, slaHours: Number(form.slaHours), assigneeRoleKey: form.assigneeRoleKey || null } }), "Category added").then(() => setForm({ name: "", slaHours: "48", assigneeRoleKey: "" })); }}
      >
        <Input placeholder="Category name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <Input type="number" min={1} placeholder="SLA hours" value={form.slaHours} onChange={(e) => setForm({ ...form, slaHours: e.target.value })} required />
        <NativeSelect value={form.assigneeRoleKey} onChange={(e) => setForm({ ...form, assigneeRoleKey: e.target.value })}><option value="">No auto-assignment</option>{roleKeys.map((k) => <option key={k} value={k}>{k}</option>)}</NativeSelect>
        <Button type="submit" size="sm" disabled={busy}><Plus /> Add</Button>
      </form>
      <Table>
        <TableHeader><TableRow><TableHead>Category</TableHead><TableHead>SLA (h)</TableHead><TableHead>Auto-assign role</TableHead><TableHead className="text-right">Tickets</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>
          {categories.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-medium">{c.name}</TableCell>
              <TableCell><Input type="number" min={1} defaultValue={c.slaHours} className="h-7 w-20" disabled={busy} onBlur={(e) => { const v = Number(e.target.value); if (v !== c.slaHours && v > 0) void call(() => apiFetch(`/api/v1/ticket-categories/${c.id}`, { method: "PATCH", body: { slaHours: v } }), "SLA updated"); }} /></TableCell>
              <TableCell><NativeSelect className="h-7 w-44" value={c.assigneeRoleKey ?? ""} disabled={busy} onChange={(e) => call(() => apiFetch(`/api/v1/ticket-categories/${c.id}`, { method: "PATCH", body: { assigneeRoleKey: e.target.value || null } }), "Routing updated")}><option value="">None</option>{roleKeys.map((k) => <option key={k} value={k}>{k}</option>)}</NativeSelect></TableCell>
              <TableCell className="text-right tabular-nums">{c.ticketCount}</TableCell>
              <TableCell className="text-right">{c.ticketCount === 0 && <Button size="icon-xs" variant="ghost" aria-label="Delete" disabled={busy} onClick={() => confirm(`Delete category ${c.name}?`) && call(() => apiFetch(`/api/v1/ticket-categories/${c.id}`, { method: "DELETE" }), "Category deleted")}><Trash2 /></Button>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
