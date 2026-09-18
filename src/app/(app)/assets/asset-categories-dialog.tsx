"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiFetch, ApiError } from "@/lib/client/api";

export function AssetCategoriesDialog({ categories }: { categories: { id: string; name: string; assetCount: number }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function call(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}><Tags /> Categories</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Asset categories</DialogTitle><DialogDescription>Categories with assets cannot be deleted.</DialogDescription></DialogHeader>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void call(() => apiFetch("/api/v1/asset-categories", { method: "POST", body: { name } })).then(() => setName("")); }}>
            <Input placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} required />
            <Button type="submit" disabled={busy}>Add</Button>
          </form>
          <ul className="divide-y rounded-lg border text-sm">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center justify-between p-2">
                <span>{c.name} <span className="text-xs text-muted-foreground">· {c.assetCount}</span></span>
                {c.assetCount === 0 && <Button size="xs" variant="ghost" className="text-destructive" disabled={busy} onClick={() => confirm(`Delete ${c.name}?`) && call(() => apiFetch(`/api/v1/asset-categories/${c.id}`, { method: "DELETE" }))}>Delete</Button>}
              </li>
            ))}
          </ul>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </>
  );
}
