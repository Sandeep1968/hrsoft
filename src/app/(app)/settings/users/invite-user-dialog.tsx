"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, ApiError } from "@/lib/client/api";
import { TempPasswordBox } from "./temp-password";

export function InviteUserDialog({ roles }: { roles: { key: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: "", name: "" });
  const [keys, setKeys] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ email: string; tempPassword: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (keys.length === 0) return toast.error("Pick at least one role");
    setBusy(true);
    try {
      const r = await apiFetch<{ user: { email: string }; tempPassword: string }>("/api/v1/users", { method: "POST", body: { ...form, roleKeys: keys } });
      setResult({ email: r.user.email, tempPassword: r.tempPassword });
      setForm({ email: "", name: "" });
      setKeys([]);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not invite user");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button onClick={() => { setResult(null); setOpen(true); }}><UserPlus /> Invite user</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          {result ? (
            <>
              <DialogHeader><DialogTitle>Invitation sent</DialogTitle><DialogDescription>{result.email} has been emailed a temporary password. It is shown here once in case the email does not arrive.</DialogDescription></DialogHeader>
              <TempPasswordBox value={result.tempPassword} />
              <DialogFooter><Button onClick={() => setOpen(false)}>Done</Button></DialogFooter>
            </>
          ) : (
            <form onSubmit={submit} className="contents">
              <DialogHeader><DialogTitle>Invite a user</DialogTitle><DialogDescription>For login-only accounts such as auditors or contractors. Employees get their user automatically when created in the directory.</DialogDescription></DialogHeader>
              <div className="grid gap-3">
                <div className="grid gap-1.5"><Label htmlFor="u-name">Name</Label><Input id="u-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
                <div className="grid gap-1.5"><Label htmlFor="u-email">Email</Label><Input id="u-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
                <div className="grid gap-1.5">
                  <Label>Roles</Label>
                  <div className="grid max-h-48 gap-1 overflow-auto rounded-lg border p-2 text-sm sm:grid-cols-2">
                    {roles.map((r) => <label key={r.key} className="flex items-center gap-2"><Checkbox checked={keys.includes(r.key)} onCheckedChange={(v) => setKeys(v ? [...keys, r.key] : keys.filter((k) => k !== r.key))} /> {r.name}</label>)}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
                <Button type="submit" disabled={busy}>{busy ? "Inviting…" : "Send invite"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
