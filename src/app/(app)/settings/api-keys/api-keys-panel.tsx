"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/common";
import { apiFetch, ApiError } from "@/lib/client/api";
import { fmtDateTime } from "@/lib/dates";
import type { ApiKeyDto } from "@/server/services/apikeys";
import { TempPasswordBox } from "../users/temp-password";

interface Group { module: string; label: string; permissions: { permission: string; description: string }[] }

export function ApiKeysPanel({ keys, groups, showOwner }: { keys: ApiKeyDto[]; groups: Group[]; showOwner: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [all, setAll] = useState(false);
  const [scopes, setScopes] = useState<string[]>([]);
  const [expires, setExpires] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!all && scopes.length === 0) return toast.error("Pick at least one scope");
    setBusy(true);
    try {
      const r = await apiFetch<{ key: string }>("/api/v1/api-keys", { method: "POST", body: { name, scopes: all ? ["*"] : scopes, expiresAt: expires ? new Date(`${expires}T23:59:59.999Z`).toISOString() : null } });
      setCreated(r.key);
      setName("");
      setScopes([]);
      setAll(false);
      setExpires("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create key");
    } finally {
      setBusy(false);
    }
  }
  async function revoke(k: ApiKeyDto) {
    if (!confirm(`Revoke key "${k.name}"? Requests using it will fail immediately.`)) return;
    try {
      await apiFetch(`/api/v1/api-keys/${k.id}`, { method: "DELETE" });
      toast.success("Key revoked");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not revoke");
    }
  }
  const toggle = (p: string) => setScopes((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
  const toggleModule = (g: Group) => {
    const ps = g.permissions.map((p) => p.permission);
    const allOn = ps.every((p) => scopes.includes(p));
    setScopes((s) => (allOn ? s.filter((x) => !ps.includes(x)) : [...new Set([...s, ...ps])]));
  };

  return (
    <div>
      <div className="mb-3 flex justify-end"><Button onClick={() => { setCreated(null); setOpen(true); }}><Plus /> Create key</Button></div>
      {keys.length === 0 ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No API keys yet.</p> : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Prefix</TableHead>{showOwner && <TableHead>Owner</TableHead>}<TableHead>Scopes</TableHead><TableHead>Status</TableHead><TableHead>Last used</TableHead><TableHead>Expires</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
                  {showOwner && <TableCell className="text-xs">{k.owner?.email ?? "—"}</TableCell>}
                  <TableCell className="max-w-64 whitespace-normal text-xs">{k.scopes.includes("*") ? <span className="font-medium">All of the owner&apos;s permissions</span> : `${k.scopes.length} scope${k.scopes.length === 1 ? "" : "s"}: ${k.scopes.slice(0, 4).join(", ")}${k.scopes.length > 4 ? "…" : ""}`}</TableCell>
                  <TableCell><StatusBadge status={k.state === "ACTIVE" ? "ACTIVE" : k.state === "REVOKED" ? "CANCELLED" : "EXITED"} className={k.state !== "ACTIVE" ? "" : ""} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmtDateTime(k.lastUsedAt)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{k.expiresAt ? fmtDateTime(k.expiresAt) : "never"}</TableCell>
                  <TableCell className="text-right">{k.state === "ACTIVE" && <Button size="xs" variant="ghost" className="text-destructive" onClick={() => revoke(k)}>Revoke</Button>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          {created ? (
            <>
              <DialogHeader><DialogTitle className="flex items-center gap-2"><KeyRound className="size-4" /> Key created</DialogTitle><DialogDescription>Copy it now — it will not be shown again.</DialogDescription></DialogHeader>
              <TempPasswordBox value={created} />
              <DialogFooter><Button onClick={() => setOpen(false)}>Done</Button></DialogFooter>
            </>
          ) : (
            <form onSubmit={create} className="contents">
              <DialogHeader><DialogTitle>Create API key</DialogTitle><DialogDescription>The key acts as you; scopes can only narrow your own permissions.</DialogDescription></DialogHeader>
              <div className="grid gap-3">
                <div className="grid gap-1.5"><Label htmlFor="k-name">Name</Label><Input id="k-name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Payroll sync" /></div>
                <div className="grid gap-1.5"><Label htmlFor="k-exp">Expires (optional)</Label><Input id="k-exp" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></div>
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={all} onCheckedChange={(v) => setAll(Boolean(v))} /> All my permissions (<code>*</code>)</label>
                {!all && (
                  <div className="max-h-72 space-y-2 overflow-auto rounded-lg border p-2 text-sm">
                    {groups.map((g) => (
                      <div key={g.module}>
                        <button type="button" className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground" onClick={() => toggleModule(g)}>{g.label}</button>
                        <div className="grid gap-1 sm:grid-cols-2">{g.permissions.map((p) => <label key={p.permission} className="flex items-center gap-2 font-mono text-xs"><Checkbox checked={scopes.includes(p.permission)} onCheckedChange={() => toggle(p.permission)} /> {p.permission}</label>)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
                <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create key"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
