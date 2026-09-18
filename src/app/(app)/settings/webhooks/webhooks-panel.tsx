"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch, ApiError } from "@/lib/client/api";
import { fmtDateTime } from "@/lib/dates";
import { TempPasswordBox } from "../users/temp-password";

interface Hook { id: string; url: string; secretMasked: string; events: string[]; isActive: boolean; createdAt: string }

export function WebhooksPanel({ hooks, events }: { hooks: Hook[]; events: readonly string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Hook | null>(null);
  const [url, setUrl] = useState("");
  const [sel, setSel] = useState<string[]>(["*"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function openCreate() { setEditing(null); setUrl(""); setSel(["*"]); setSecret(null); setOpen(true); }
  function openEdit(h: Hook) { setEditing(h); setUrl(h.url); setSel(h.events); setSecret(null); setOpen(true); }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    try {
      if (editing) {
        await apiFetch(`/api/v1/webhooks/${editing.id}`, { method: "PATCH", body: { url, events: sel } });
        toast.success("Webhook updated");
        setOpen(false);
      } else {
        const r = await apiFetch<{ secret: string }>("/api/v1/webhooks", { method: "POST", body: { url, events: sel, isActive: true } });
        setSecret(r.secret);
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save webhook");
    } finally {
      setBusy(null);
    }
  }
  async function act(id: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(id);
    try {
      await fn();
      if (ok) toast.success(ok);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }
  async function test(h: Hook) {
    setBusy(h.id);
    try {
      const r = await apiFetch<{ ok: boolean; status: number | null; error?: string; ms: number }>(`/api/v1/webhooks/${h.id}/test`, { method: "POST" });
      if (r.ok) toast.success(`Delivered: HTTP ${r.status} in ${r.ms}ms`);
      else toast.error(`Failed: ${r.status ? `HTTP ${r.status}` : r.error ?? "no response"} (${r.ms}ms)`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Test failed");
    } finally {
      setBusy(null);
    }
  }
  async function rotate(h: Hook) {
    if (!confirm("Rotate the signing secret? The receiver must be updated with the new secret.")) return;
    setBusy(h.id);
    try {
      const r = await apiFetch<{ secret: string }>(`/api/v1/webhooks/${h.id}`, { method: "POST" });
      setEditing(h);
      setUrl(h.url);
      setSel(h.events);
      setSecret(r.secret);
      setOpen(true);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not rotate secret");
    } finally {
      setBusy(null);
    }
  }
  const toggle = (ev: string) => {
    if (ev === "*") return setSel(sel.includes("*") ? [] : ["*"]);
    setSel((s) => { const next = s.includes(ev) ? s.filter((x) => x !== ev) : [...s.filter((x) => x !== "*"), ev]; return next; });
  };

  return (
    <div>
      <div className="mb-3 flex justify-end"><Button onClick={openCreate}><Plus /> Add webhook</Button></div>
      {hooks.length === 0 ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No webhooks configured.</p> : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>URL</TableHead><TableHead>Events</TableHead><TableHead>Secret</TableHead><TableHead>Active</TableHead><TableHead>Created</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {hooks.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="max-w-72 truncate font-mono text-xs" title={h.url}>{h.url}</TableCell>
                  <TableCell className="max-w-56 whitespace-normal text-xs">{h.events.includes("*") ? "All events" : h.events.join(", ")}</TableCell>
                  <TableCell className="font-mono text-xs">{h.secretMasked}</TableCell>
                  <TableCell><Switch checked={h.isActive} disabled={busy === h.id} onCheckedChange={(v) => act(h.id, () => apiFetch(`/api/v1/webhooks/${h.id}`, { method: "PATCH", body: { isActive: v } }))} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmtDateTime(h.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="xs" variant="outline" disabled={busy === h.id} onClick={() => test(h)}><Send /> Test</Button>
                      <Button size="xs" variant="ghost" onClick={() => openEdit(h)}>Edit</Button>
                      <Button size="xs" variant="ghost" disabled={busy === h.id} onClick={() => rotate(h)}>Rotate</Button>
                      <Button size="xs" variant="ghost" className="text-destructive" disabled={busy === h.id} onClick={() => confirm("Delete this webhook?") && act(h.id, () => apiFetch(`/api/v1/webhooks/${h.id}`, { method: "DELETE" }), "Webhook deleted")}>Delete</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          {secret ? (
            <>
              <DialogHeader><DialogTitle>Signing secret</DialogTitle><DialogDescription>Store this on the receiver. Payloads are signed with <code>X-HRsoft-Signature: sha256=HMAC_SHA256(secret, body)</code>. It will not be shown again.</DialogDescription></DialogHeader>
              <TempPasswordBox value={secret} />
              <DialogFooter><Button onClick={() => setOpen(false)}>Done</Button></DialogFooter>
            </>
          ) : (
            <form onSubmit={save} className="contents">
              <DialogHeader><DialogTitle>{editing ? "Edit webhook" : "Add webhook"}</DialogTitle><DialogDescription>HRsoft POSTs JSON <code>{`{ id, event, createdAt, data }`}</code> with a 5-second timeout. Failures are logged, not retried.</DialogDescription></DialogHeader>
              <div className="grid gap-3">
                <div className="grid gap-1.5"><Label htmlFor="w-url">Endpoint URL (https)</Label><Input id="w-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="https://example.com/hooks/hrsoft" /></div>
                <div className="grid gap-1.5">
                  <Label>Events</Label>
                  <div className="grid max-h-60 gap-1 overflow-auto rounded-lg border p-2 text-sm sm:grid-cols-2">
                    {events.map((ev) => <label key={ev} className="flex items-center gap-2 font-mono text-xs"><Checkbox checked={sel.includes(ev) || (ev !== "*" && sel.includes("*"))} disabled={ev !== "*" && sel.includes("*")} onCheckedChange={() => toggle(ev)} /> {ev === "*" ? "* (all events)" : ev}</label>)}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy === "save"}>Cancel</Button>
                <Button type="submit" disabled={busy === "save" || sel.length === 0}>{busy === "save" ? "Saving…" : editing ? "Save" : "Create"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
