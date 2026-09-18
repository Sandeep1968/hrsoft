"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/common/native-select";
import { DL, StatusBadge } from "@/components/common";
import { EmployeePicker, type EmployeeOption } from "@/components/psa/employee-picker";
import { apiFetch, ApiError } from "@/lib/client/api";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/dates";
import type { AssetDto } from "@/server/services/assets";
import { AssetDialog } from "./asset-dialog";

interface HistoryRow { id: string; employee: { id: string; displayName: string; employeeCode: string }; assignedBy: string | null; assignedAt: string; returnedAt: string | null; condition: string | null; notes: string | null }
interface Lookups { categories: { id: string; name: string }[]; locations: { id: string; name: string }[] }

export function AssetActions({ asset, lookups }: { asset: AssetDto; lookups: Lookups }) {
  const router = useRouter();
  const [mode, setMode] = useState<"assign" | "return" | null>(null);
  const [detail, setDetail] = useState(false);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [emp, setEmp] = useState<EmployeeOption | null>(null);
  const [condition, setCondition] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("AVAILABLE");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!detail) return;
    apiFetch<AssetDto & { history: HistoryRow[] }>(`/api/v1/assets/${asset.id}`).then((a) => setHistory(a.history)).catch(() => setHistory([]));
  }, [detail, asset.id]);

  async function act() {
    setBusy(true);
    try {
      if (mode === "assign") {
        if (!emp) return toast.error("Pick an employee");
        await apiFetch(`/api/v1/assets/${asset.id}/assign`, { method: "POST", body: { employeeId: emp.id, condition: condition || null, notes: notes || null } });
        toast.success(`Assigned to ${emp.displayName}`);
      } else {
        await apiFetch(`/api/v1/assets/${asset.id}/return`, { method: "POST", body: { condition: condition || null, notes: notes || null, status } });
        toast.success("Return recorded");
      }
      setMode(null);
      setEmp(null);
      setCondition("");
      setNotes("");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button size="xs" variant="ghost" onClick={() => setDetail(true)}>Details</Button>
      {asset.status === "AVAILABLE" && <Button size="xs" variant="outline" onClick={() => setMode("assign")}>Assign</Button>}
      {asset.status === "ASSIGNED" && <Button size="xs" variant="outline" onClick={() => setMode("return")}>Return</Button>}

      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode === "assign" ? "Assign asset" : "Record return"}</DialogTitle>
            <DialogDescription>{asset.assetTag} · {asset.name}{asset.assignedTo ? ` · currently with ${asset.assignedTo.displayName}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {mode === "assign" && <div className="grid gap-1.5"><Label>Employee</Label><EmployeePicker value={emp} onChange={setEmp} autoFocus /></div>}
            {mode === "return" && <div className="grid gap-1.5"><Label htmlFor="r-status">Status after return</Label><NativeSelect id="r-status" value={status} onChange={(e) => setStatus(e.target.value)}>{["AVAILABLE", "IN_REPAIR", "RETIRED", "LOST"].map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</NativeSelect></div>}
            <div className="grid gap-1.5"><Label htmlFor="r-cond">Condition</Label><Input id="r-cond" value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="e.g. Good, minor scratches" /></div>
            <div className="grid gap-1.5"><Label htmlFor="r-notes">Notes</Label><Textarea id="r-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)} disabled={busy}>Cancel</Button>
            <Button onClick={act} disabled={busy || (mode === "assign" && !emp)}>{busy ? "Saving…" : mode === "assign" ? "Assign" : "Record return"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={detail} onOpenChange={setDetail}>
        <SheetContent className="overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{asset.assetTag} · {asset.name}</SheetTitle>
            <SheetDescription>{asset.category.name}{asset.location ? ` · ${asset.location.name}` : ""}</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-4">
            <div className="flex items-center gap-2"><StatusBadge status={asset.status} />{asset.warrantyState === "EXPIRING" && <span className="text-xs text-amber-700">Warranty expires in {asset.warrantyDaysLeft} days</span>}{asset.warrantyState === "EXPIRED" && <span className="text-xs text-red-600">Warranty expired</span>}<span className="ml-auto"><AssetDialog lookups={lookups} initial={asset} compact /></span></div>
            <DL items={[
              { label: "Serial", value: asset.serialNumber ?? "—" },
              { label: "Vendor", value: asset.vendor ?? "—" },
              { label: "Purchased", value: fmtDate(asset.purchaseDate) },
              { label: "Cost", value: asset.purchaseCost === null ? "—" : fmtMoney(asset.purchaseCost) },
              { label: "Warranty until", value: fmtDate(asset.warrantyUntil) },
              { label: "Assigned to", value: asset.assignedTo ? `${asset.assignedTo.displayName} (${asset.assignedTo.employeeCode})` : "—" },
            ]} />
            {asset.notes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{asset.notes}</p>}
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Assignment history</div>
              {history === null ? <p className="text-sm text-muted-foreground">Loading…</p> : history.length === 0 ? <p className="text-sm text-muted-foreground">Never assigned.</p> : (
                <ol className="space-y-2 text-sm">
                  {history.map((h) => (
                    <li key={h.id} className="rounded-lg border p-2">
                      <div className="flex justify-between"><span className="font-medium">{h.employee.displayName}</span><span className="text-xs text-muted-foreground">{h.returnedAt ? "Returned" : "Current"}</span></div>
                      <div className="text-xs text-muted-foreground">{fmtDateTime(h.assignedAt)}{h.returnedAt ? ` → ${fmtDateTime(h.returnedAt)}` : ""}{h.assignedBy ? ` · by ${h.assignedBy}` : ""}</div>
                      {(h.condition || h.notes) && <div className="mt-1 whitespace-pre-wrap text-xs">{h.condition ? `Condition: ${h.condition}` : ""}{h.condition && h.notes ? " · " : ""}{h.notes ?? ""}</div>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
