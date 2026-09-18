"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/common/native-select";
import { apiFetch } from "@/lib/client/api";
import { fmtMoney, isoDate, todayUtc } from "@/lib/dates";

export interface CategoryOpt { id: string; name: string; code: string; maxAmountPerClaim: number | null; requiresReceipt: boolean }
interface ItemDraft { key: number; categoryId: string; date: string; amount: string; merchant: string; description: string; file: File | null }

export function ClaimForm({ categories }: { categories: CategoryOpt[] }) {
  const router = useRouter();
  const today = isoDate(todayUtc());
  const blank = (key: number): ItemDraft => ({ key, categoryId: categories[0]?.id ?? "", date: today, amount: "", merchant: "", description: "", file: null });
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([blank(1)]);
  const [busy, setBusy] = useState<string | null>(null);
  const total = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const set = (key: number, patch: Partial<ItemDraft>) => setItems(items.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const catOf = (id: string) => categories.find((c) => c.id === id);

  async function save(submit: boolean) {
    if (!title.trim()) return toast.error("Give the claim a title");
    if (items.some((i) => !i.categoryId || !i.amount || Number(i.amount) <= 0)) return toast.error("Every item needs a category and amount");
    if (submit && items.some((i) => catOf(i.categoryId)?.requiresReceipt && !i.file)) return toast.error("Attach a receipt for every item that requires one (or save as draft)");
    setBusy(submit ? "submit" : "save");
    try {
      const claim = await apiFetch<{ id: string; items: { id: string }[] }>("/api/v1/expense-claims", {
        method: "POST",
        body: { title, items: items.map((i) => ({ categoryId: i.categoryId, date: i.date, amount: Number(i.amount), merchant: i.merchant || undefined, description: i.description || undefined })) },
      });
      // Items come back ordered by date; map uploads by index within the same date order.
      const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
      await Promise.all(
        sorted.map(async (i, idx) => {
          if (!i.file || !claim.items[idx]) return;
          const fd = new FormData();
          fd.append("file", i.file);
          fd.append("itemId", claim.items[idx].id);
          const res = await fetch(`/api/v1/expense-claims/${claim.id}/receipt`, { method: "POST", body: fd });
          if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error?.message ?? "Receipt upload failed");
        }),
      );
      if (submit) await apiFetch(`/api/v1/expense-claims/${claim.id}/submit`, { method: "POST" });
      toast.success(submit ? "Claim submitted for approval" : "Draft saved");
      router.push(`/expenses/${claim.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save claim");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 p-4">
          <div className="grid gap-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Client visit — Bengaluru, Sep 2026" />
          </div>
        </CardContent>
      </Card>
      {items.map((it, idx) => {
        const cat = catOf(it.categoryId);
        return (
          <Card key={it.key}>
            <CardContent className="grid gap-3 p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Item {idx + 1}</div>
                {items.length > 1 && <Button variant="ghost" size="icon-sm" aria-label="Remove item" onClick={() => setItems(items.filter((i) => i.key !== it.key))}><Trash2 /></Button>}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label>Category</Label>
                  <NativeSelect value={it.categoryId} onChange={(e) => set(it.key, { categoryId: e.target.value })}>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </NativeSelect>
                  {cat?.maxAmountPerClaim && <span className="text-xs text-muted-foreground">Max {fmtMoney(cat.maxAmountPerClaim)} per claim</span>}
                </div>
                <div className="grid gap-1.5">
                  <Label>Date</Label>
                  <Input type="date" max={today} value={it.date} onChange={(e) => set(it.key, { date: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Amount (₹)</Label>
                  <Input type="number" min={1} step="0.01" value={it.amount} onChange={(e) => set(it.key, { amount: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Merchant</Label>
                  <Input value={it.merchant} onChange={(e) => set(it.key, { merchant: e.target.value })} placeholder="Optional" />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Description</Label>
                  <Input value={it.description} onChange={(e) => set(it.key, { description: e.target.value })} placeholder="Optional" />
                </div>
                <div className="grid gap-1.5 sm:col-span-3">
                  <Label>Receipt {cat?.requiresReceipt ? <span className="text-xs text-muted-foreground">(required)</span> : <span className="text-xs text-muted-foreground">(optional)</span>}</Label>
                  <Input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => set(it.key, { file: e.target.files?.[0] ?? null })} />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
      <Button variant="outline" onClick={() => setItems([...items, blank(Date.now())])}><Plus /> Add item</Button>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-4">
        <div className="text-sm">Total <span className="text-lg font-semibold tabular-nums">{fmtMoney(total)}</span> · {items.length} item{items.length === 1 ? "" : "s"}</div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => save(false)} disabled={busy !== null}>{busy === "save" ? "Saving…" : "Save draft"}</Button>
          <Button onClick={() => save(true)} disabled={busy !== null}>{busy === "submit" ? "Submitting…" : "Submit for approval"}</Button>
        </div>
      </div>
    </div>
  );
}
