"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/common/native-select";
import { StatusBadge } from "@/components/common";
import { apiFetch } from "@/lib/client/api";

export interface ComponentRow {
  id: string;
  name: string;
  code: string;
  type: "EARNING" | "DEDUCTION" | "EMPLOYER_CONTRIBUTION" | "REIMBURSEMENT";
  isTaxable: boolean;
  isStatutory: boolean;
  isPartOfCtc: boolean;
  isProrated: boolean;
  showInPayslip: boolean;
  order: number;
  isActive: boolean;
}

const EMPTY: Omit<ComponentRow, "id"> = { name: "", code: "", type: "EARNING", isTaxable: true, isStatutory: false, isPartOfCtc: true, isProrated: true, showInPayslip: true, order: 0, isActive: true };

export function ComponentsTab({ components }: { components: ComponentRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ComponentRow | Omit<ComponentRow, "id"> | null>(null);
  const [busy, setBusy] = useState(false);
  const isEdit = editing !== null && "id" in editing;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      if ("id" in editing) {
        const { id, ...data } = editing;
        await apiFetch(`/api/v1/payroll/components/${id}`, { method: "PATCH", body: data });
      } else await apiFetch("/api/v1/payroll/components", { method: "POST", body: editing });
      toast.success("Component saved");
      setEditing(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }
  async function remove(c: ComponentRow) {
    if (!confirm(`Delete ${c.name}? Components used in a structure are deactivated instead.`)) return;
    try {
      await apiFetch(`/api/v1/payroll/components/${c.id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete");
    }
  }
  const flag = (k: keyof Omit<ComponentRow, "id" | "name" | "code" | "type" | "order">, label: string) =>
    editing && (
      <Label className="gap-2 font-normal">
        <Checkbox checked={Boolean(editing[k])} onCheckedChange={(v) => setEditing({ ...editing, [k]: Boolean(v) })} /> {label}
      </Label>
    );

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={() => setEditing({ ...EMPTY, order: components.length + 1 })}><Plus /> New component</Button>
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Taxable</TableHead>
              <TableHead>Prorated</TableHead>
              <TableHead>Statutory</TableHead>
              <TableHead>In CTC</TableHead>
              <TableHead>Active</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {components.map((c) => (
              <TableRow key={c.id} className={c.isActive ? "" : "opacity-60"}>
                <TableCell className="tabular-nums">{c.order}</TableCell>
                <TableCell className="font-mono text-xs">{c.code}</TableCell>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell><StatusBadge status={c.type} /></TableCell>
                <TableCell>{c.isTaxable ? "Yes" : "No"}</TableCell>
                <TableCell>{c.isProrated ? "Yes" : "No"}</TableCell>
                <TableCell>{c.isStatutory ? "Yes" : "No"}</TableCell>
                <TableCell>{c.isPartOfCtc ? "Yes" : "No"}</TableCell>
                <TableCell>{c.isActive ? "Yes" : "No"}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setEditing(c)}><Pencil /></Button>
                  {!c.isStatutory && <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={() => remove(c)}><Trash2 /></Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          {editing && (
            <form onSubmit={save} className="contents">
              <DialogHeader><DialogTitle>{isEdit ? "Edit component" : "New component"}</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="c-code">Code</Label>
                    <Input id="c-code" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} placeholder="LTA" required disabled={isEdit && editing.isStatutory} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="c-order">Order</Label>
                    <Input id="c-order" type="number" min={0} value={editing.order} onChange={(e) => setEditing({ ...editing, order: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="c-name">Name</Label>
                  <Input id="c-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="c-type">Type</Label>
                  <NativeSelect id="c-type" value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value as ComponentRow["type"] })} disabled={isEdit && editing.isStatutory}>
                    <option value="EARNING">Earning</option>
                    <option value="DEDUCTION">Deduction</option>
                    <option value="EMPLOYER_CONTRIBUTION">Employer contribution</option>
                    <option value="REIMBURSEMENT">Reimbursement</option>
                  </NativeSelect>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {flag("isTaxable", "Taxable")}
                  {flag("isProrated", "Prorated on LOP")}
                  {flag("isPartOfCtc", "Part of CTC")}
                  {flag("showInPayslip", "Show in payslip")}
                  {flag("isActive", "Active")}
                </div>
              </div>
              <DialogFooter showCloseButton>
                <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
