"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/common/native-select";
import { apiFetch } from "@/lib/client/api";
import { MONTHS } from "@/lib/dates";

export function NewRunDialog({ entities, defaultMonth, defaultYear }: { entities: { id: string; name: string }[]; defaultMonth: number; defaultYear: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [entityId, setEntityId] = useState(entities[0]?.id ?? "");
  const [month, setMonth] = useState(defaultMonth);
  const [year, setYear] = useState(defaultYear);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const run = await apiFetch<{ id: string; employeeCount: number }>("/api/v1/payroll/runs", { method: "POST", body: { legalEntityId: entityId || undefined, month, year } });
      toast.success(`Run created for ${run.employeeCount.toLocaleString("en-IN")} employees`);
      setOpen(false);
      router.push(`/payroll/runs/${run.id}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create run");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> New run
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={submit} className="contents">
            <DialogHeader>
              <DialogTitle>New payroll run</DialogTitle>
              <DialogDescription>One run per legal entity per month. Employees active in the month with a current salary are included.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              {entities.length > 1 && (
                <div className="grid gap-1.5">
                  <Label htmlFor="entity">Legal entity</Label>
                  <NativeSelect id="entity" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
                    {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </NativeSelect>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="month">Month</Label>
                  <NativeSelect id="month" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                    {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </NativeSelect>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="year">Year</Label>
                  <Input id="year" type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} />
                </div>
              </div>
            </div>
            <DialogFooter showCloseButton>
              <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create run"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
