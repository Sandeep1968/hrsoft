"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/common/native-select";
import { apiFetch, ApiError } from "@/lib/client/api";
import type { AssetDto } from "@/server/services/assets";

interface Lookups { categories: { id: string; name: string }[]; locations: { id: string; name: string }[] }

export function AssetDialog({ lookups, initial, compact }: { lookups: Lookups; initial?: AssetDto; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    categoryId: initial?.category.id ?? lookups.categories[0]?.id ?? "",
    name: initial?.name ?? "",
    assetTag: initial?.assetTag ?? "",
    serialNumber: initial?.serialNumber ?? "",
    purchaseDate: initial?.purchaseDate ?? "",
    purchaseCost: initial?.purchaseCost?.toString() ?? "",
    vendor: initial?.vendor ?? "",
    warrantyUntil: initial?.warrantyUntil ?? "",
    locationId: initial?.location?.id ?? "",
    notes: initial?.notes ?? "",
    status: initial?.status ?? "AVAILABLE",
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        categoryId: form.categoryId,
        name: form.name,
        assetTag: form.assetTag,
        serialNumber: form.serialNumber || null,
        purchaseDate: form.purchaseDate || null,
        purchaseCost: form.purchaseCost === "" ? null : Number(form.purchaseCost),
        vendor: form.vendor || null,
        warrantyUntil: form.warrantyUntil || null,
        locationId: form.locationId || null,
        notes: form.notes || null,
      };
      if (initial) {
        if (initial.status !== "ASSIGNED" && form.status !== initial.status) body.status = form.status;
        await apiFetch(`/api/v1/assets/${initial.id}`, { method: "PATCH", body });
        toast.success("Asset updated");
      } else {
        await apiFetch("/api/v1/assets", { method: "POST", body });
        toast.success("Asset added");
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save asset");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {initial ? <Button size={compact ? "xs" : "sm"} variant="outline" onClick={() => setOpen(true)}><Pencil /> Edit</Button> : <Button onClick={() => setOpen(true)}><Plus /> Add asset</Button>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submit} className="contents">
            <DialogHeader>
              <DialogTitle>{initial ? `Edit ${initial.assetTag}` : "Add asset"}</DialogTitle>
              <DialogDescription>Asset tags must be unique. Warranty dates drive the expiry warnings.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5"><Label htmlFor="a-tag">Asset tag</Label><Input id="a-tag" value={form.assetTag} onChange={(e) => set("assetTag", e.target.value.toUpperCase())} required placeholder="LT-0001" /></div>
              <div className="grid gap-1.5"><Label htmlFor="a-cat">Category</Label><NativeSelect id="a-cat" value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)} required>{lookups.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></div>
              <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="a-name">Name / model</Label><Input id="a-name" value={form.name} onChange={(e) => set("name", e.target.value)} required placeholder='MacBook Pro 14" M4' /></div>
              <div className="grid gap-1.5"><Label htmlFor="a-serial">Serial number</Label><Input id="a-serial" value={form.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="a-loc">Location</Label><NativeSelect id="a-loc" value={form.locationId} onChange={(e) => set("locationId", e.target.value)}><option value="">—</option>{lookups.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</NativeSelect></div>
              <div className="grid gap-1.5"><Label htmlFor="a-pd">Purchase date</Label><Input id="a-pd" type="date" value={form.purchaseDate} onChange={(e) => set("purchaseDate", e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="a-cost">Purchase cost (₹)</Label><Input id="a-cost" type="number" min={0} value={form.purchaseCost} onChange={(e) => set("purchaseCost", e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="a-vendor">Vendor</Label><Input id="a-vendor" value={form.vendor} onChange={(e) => set("vendor", e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="a-war">Warranty until</Label><Input id="a-war" type="date" value={form.warrantyUntil} onChange={(e) => set("warrantyUntil", e.target.value)} /></div>
              {initial && initial.status !== "ASSIGNED" && (
                <div className="grid gap-1.5"><Label htmlFor="a-status">Status</Label><NativeSelect id="a-status" value={form.status} onChange={(e) => set("status", e.target.value)}>{["AVAILABLE", "IN_REPAIR", "RETIRED", "LOST"].map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</NativeSelect></div>
              )}
              <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="a-notes">Notes</Label><Textarea id="a-notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? "Saving…" : initial ? "Save" : "Add asset"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
