"use client";

import { useState } from "react";
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

export function CreateRoleDialog({ templates }: { templates: { id: string; key: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ key: "", name: "", description: "", copyFrom: "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      let grants: { permission: string; scope: string }[] = [];
      if (form.copyFrom) grants = (await apiFetch<{ grants: { permission: string; scope: string }[] }>(`/api/v1/roles/${form.copyFrom}`)).grants;
      const role = await apiFetch<{ id: string }>("/api/v1/roles", { method: "POST", body: { key: form.key, name: form.name, description: form.description || null, grants } });
      toast.success("Role created");
      setOpen(false);
      router.push(`/settings/roles/${role.id}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create role");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus /> New role</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={submit} className="contents">
            <DialogHeader><DialogTitle>Create role</DialogTitle><DialogDescription>Start empty or copy the grants of an existing role, then fine-tune permissions on the next screen.</DialogDescription></DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5"><Label htmlFor="r-name">Name</Label><Input id="r-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, key: form.key || e.target.value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") })} required /></div>
              <div className="grid gap-1.5"><Label htmlFor="r-key">Key</Label><Input id="r-key" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") })} required pattern="[A-Z][A-Z0-9_]{1,39}" placeholder="HR_PARTNER" /><span className="text-xs text-muted-foreground">Uppercase letters, digits and underscores. Cannot be changed later.</span></div>
              <div className="grid gap-1.5"><Label htmlFor="r-desc">Description</Label><Textarea id="r-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="r-copy">Copy permissions from</Label><NativeSelect id="r-copy" value={form.copyFrom} onChange={(e) => setForm({ ...form, copyFrom: e.target.value })}><option value="">Start empty</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.key})</option>)}</NativeSelect></div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
