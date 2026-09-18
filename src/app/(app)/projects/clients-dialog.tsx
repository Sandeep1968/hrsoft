"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiFetch, ApiError } from "@/lib/client/api";

interface Client { id: string; name: string; contactName: string | null; contactEmail: string | null; isActive: boolean; projectCount: number }

export function ClientsDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Client[]>([]);
  const [form, setForm] = useState({ name: "", contactName: "", contactEmail: "" });
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setItems((await apiFetch<{ items: Client[] }>("/api/v1/clients?pageSize=200&includeInactive=true")).items);
    } catch {
      setItems([]);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch("/api/v1/clients", { method: "POST", body: { name: form.name, contactName: form.contactName || null, contactEmail: form.contactEmail || null } });
      setForm({ name: "", contactName: "", contactEmail: "" });
      toast.success("Client added");
      await load();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not add client");
    } finally {
      setBusy(false);
    }
  }
  async function toggle(c: Client) {
    try {
      await apiFetch(`/api/v1/clients/${c.id}`, { method: "PATCH", body: { isActive: !c.isActive } });
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update client");
    }
  }
  async function remove(c: Client) {
    if (!confirm(`Delete client ${c.name}?`)) return;
    try {
      await apiFetch(`/api/v1/clients/${c.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete client");
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => { setOpen(true); void load(); }}><Building2 /> Clients</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Clients</DialogTitle>
            <DialogDescription>Customers that projects are billed to.</DialogDescription>
          </DialogHeader>
          <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <Input placeholder="Client name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Input placeholder="Contact name" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
            <Input placeholder="Contact email" type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
            <Button type="submit" disabled={busy}>Add</Button>
          </form>
          <ul className="max-h-72 divide-y overflow-auto rounded-lg border text-sm">
            {items.length === 0 && <li className="p-3 text-muted-foreground">No clients yet.</li>}
            {items.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 p-2">
                <div className="min-w-0">
                  <div className={c.isActive ? "" : "text-muted-foreground line-through"}>{c.name}</div>
                  <div className="text-xs text-muted-foreground">{c.contactName ?? "—"}{c.contactEmail ? ` · ${c.contactEmail}` : ""} · {c.projectCount} project{c.projectCount === 1 ? "" : "s"}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="xs" variant="ghost" onClick={() => toggle(c)}>{c.isActive ? "Deactivate" : "Activate"}</Button>
                  {c.projectCount === 0 && <Button size="xs" variant="ghost" className="text-destructive" onClick={() => remove(c)}>Delete</Button>}
                </div>
              </li>
            ))}
          </ul>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </>
  );
}
