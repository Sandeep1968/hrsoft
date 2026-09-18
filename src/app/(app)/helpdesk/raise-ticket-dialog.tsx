"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/common/native-select";
import { apiFetch, ApiError } from "@/lib/client/api";

interface Category { id: string; name: string; slaHours: number }

export function RaiseTicketDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cats, setCats] = useState<Category[]>([]);
  const [form, setForm] = useState({ categoryId: "", subject: "", description: "", priority: "MEDIUM" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    apiFetch<Category[]>("/api/v1/ticket-categories").then((c) => { setCats(c); setForm((f) => ({ ...f, categoryId: f.categoryId || c[0]?.id || "" })); }).catch(() => setCats([]));
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const t = await apiFetch<{ id: string; number: number }>("/api/v1/tickets", { method: "POST", body: form });
      toast.success(`Ticket #${t.number} raised`);
      setOpen(false);
      setForm({ categoryId: cats[0]?.id ?? "", subject: "", description: "", priority: "MEDIUM" });
      router.push(`/helpdesk/${t.id}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not raise ticket");
    } finally {
      setBusy(false);
    }
  }
  const cat = cats.find((c) => c.id === form.categoryId);

  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus /> Raise ticket</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submit} className="contents">
            <DialogHeader>
              <DialogTitle>Raise a ticket</DialogTitle>
              <DialogDescription>{cat ? `${cat.name} tickets are due within ${cat.slaHours} hours.` : "Pick a category so the right team picks it up."}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5"><Label htmlFor="t-cat">Category</Label><NativeSelect id="t-cat" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} required>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></div>
                <div className="grid gap-1.5"><Label htmlFor="t-pri">Priority</Label><NativeSelect id="t-pri" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => <option key={p} value={p}>{p}</option>)}</NativeSelect></div>
              </div>
              <div className="grid gap-1.5"><Label htmlFor="t-sub">Subject</Label><Input id="t-sub" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required minLength={3} maxLength={200} /></div>
              <div className="grid gap-1.5"><Label htmlFor="t-desc">Description</Label><Textarea id="t-desc" rows={5} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required minLength={3} placeholder="What happened, since when, and what you have already tried." /></div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy || !form.categoryId}>{busy ? "Raising…" : "Raise ticket"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
