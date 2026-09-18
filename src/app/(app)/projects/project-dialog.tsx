"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/common/native-select";
import { EmployeePicker, type EmployeeOption } from "@/components/psa/employee-picker";
import { apiFetch, ApiError } from "@/lib/client/api";

export interface ProjectFormValues {
  id?: string;
  code: string;
  name: string;
  description: string | null;
  clientId: string | null;
  manager: { id: string; displayName: string } | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  isBillable: boolean;
  budgetHours: number | null;
  hourlyRate: number | null;
}

const STATUSES = ["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"];

export function ProjectDialog({ initial, canPickManager, trigger }: { initial?: ProjectFormValues; canPickManager: boolean; trigger?: "button" | "icon" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [manager, setManager] = useState<EmployeeOption | null>(initial?.manager ? { id: initial.manager.id, displayName: initial.manager.displayName, employeeCode: "", workEmail: "" } : null);
  const [form, setForm] = useState({
    code: initial?.code ?? "",
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    clientId: initial?.clientId ?? "",
    startDate: initial?.startDate ?? "",
    endDate: initial?.endDate ?? "",
    status: initial?.status ?? "ACTIVE",
    isBillable: initial?.isBillable ?? true,
    budgetHours: initial?.budgetHours?.toString() ?? "",
    hourlyRate: initial?.hourlyRate?.toString() ?? "",
  });

  useEffect(() => {
    if (!open) return;
    apiFetch<{ items: { id: string; name: string }[] }>("/api/v1/clients?pageSize=200").then((p) => setClients(p.items)).catch(() => setClients([]));
  }, [open]);

  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        code: form.code,
        name: form.name,
        description: form.description || null,
        clientId: form.clientId || null,
        managerId: manager?.id ?? null,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        status: form.status,
        isBillable: form.isBillable,
        budgetHours: form.budgetHours === "" ? null : Number(form.budgetHours),
        hourlyRate: form.hourlyRate === "" ? null : Number(form.hourlyRate),
      };
      if (initial?.id) {
        await apiFetch(`/api/v1/projects/${initial.id}`, { method: "PATCH", body });
        toast.success("Project updated");
      } else {
        const created = await apiFetch<{ id: string }>("/api/v1/projects", { method: "POST", body });
        toast.success("Project created");
        router.push(`/projects/${created.id}`);
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {trigger === "icon" ? (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Pencil /> Edit</Button>
      ) : (
        <Button onClick={() => setOpen(true)}><Plus /> New project</Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submit} className="contents">
            <DialogHeader>
              <DialogTitle>{initial?.id ? "Edit project" : "New project"}</DialogTitle>
              <DialogDescription>Code must be unique; members log time only against ACTIVE or PLANNED projects.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="p-code">Code</Label>
                <Input id="p-code" value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} required maxLength={20} placeholder="ACME-WEB" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="p-status">Status</Label>
                <NativeSelect id="p-status" value={form.status} onChange={(e) => set("status", e.target.value)}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="p-name">Name</Label>
                <Input id="p-name" value={form.name} onChange={(e) => set("name", e.target.value)} required maxLength={160} />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="p-desc">Description</Label>
                <Textarea id="p-desc" value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="p-client">Client</Label>
                <NativeSelect id="p-client" value={form.clientId} onChange={(e) => set("clientId", e.target.value)}>
                  <option value="">Internal / none</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label>Project manager</Label>
                {canPickManager ? <EmployeePicker value={manager} onChange={setManager} placeholder="Search manager…" /> : <div className="text-sm text-muted-foreground">You (project managers own the projects they create)</div>}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="p-start">Start date</Label>
                <Input id="p-start" type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="p-end">End date</Label>
                <Input id="p-end" type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="p-budget">Budget (hours)</Label>
                <Input id="p-budget" type="number" min={0} step="0.5" value={form.budgetHours} onChange={(e) => set("budgetHours", e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="p-rate">Hourly rate (₹)</Label>
                <Input id="p-rate" type="number" min={0} step="1" value={form.hourlyRate} onChange={(e) => set("hourlyRate", e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Checkbox checked={form.isBillable} onCheckedChange={(v) => set("isBillable", Boolean(v))} /> Billable project
              </label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? "Saving…" : initial?.id ? "Save changes" : "Create project"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
