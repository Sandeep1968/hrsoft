"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/client/api";

interface Values { id?: string; title: string; body: string; audienceDepartmentIds: string[]; isPinned: boolean; expiresAt: string | null }

export function AnnouncementDialog({ departments, announcement }: { departments: { id: string; name: string }[]; announcement?: Values }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = { title: fd.get("title"), body: fd.get("body"), audienceDepartmentIds: fd.getAll("audienceDepartmentIds"), isPinned: fd.get("isPinned") === "on", expiresAt: fd.get("expiresAt") ? new Date(String(fd.get("expiresAt"))).toISOString() : null };
    setBusy(true);
    try {
      if (announcement?.id) await apiFetch(`/api/v1/announcements/${announcement.id}`, { method: "PATCH", body });
      else await apiFetch("/api/v1/announcements", { method: "POST", body });
      toast.success(announcement ? "Announcement updated" : "Announcement published");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={announcement ? <Button size="xs" variant="outline" /> : <Button />}>{announcement ? "Edit" : <><Plus /> New announcement</>}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader><DialogTitle>{announcement ? "Edit announcement" : "New announcement"}</DialogTitle></DialogHeader>
          <div className="grid gap-1.5"><Label htmlFor="an-title">Title</Label><Input id="an-title" name="title" required defaultValue={announcement?.title} /></div>
          <div className="grid gap-1.5"><Label htmlFor="an-body">Message</Label><Textarea id="an-body" name="body" required rows={6} defaultValue={announcement?.body} /></div>
          <div className="grid gap-1.5">
            <Label>Audience (none selected = everyone)</Label>
            <div className="grid max-h-32 grid-cols-2 gap-1 overflow-y-auto rounded-lg border p-2 text-sm">
              {departments.map((d) => <label key={d.id} className="flex items-center gap-2"><input type="checkbox" name="audienceDepartmentIds" value={d.id} defaultChecked={announcement?.audienceDepartmentIds.includes(d.id)} /> {d.name}</label>)}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label htmlFor="an-exp">Expires (optional)</Label><Input id="an-exp" name="expiresAt" type="date" defaultValue={announcement?.expiresAt?.slice(0, 10) ?? ""} /></div>
            <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="isPinned" defaultChecked={announcement?.isPinned} /> Pin to top</label>
          </div>
          <DialogFooter showCloseButton><Button type="submit" disabled={busy}>{announcement ? "Save" : "Publish"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AnnouncementActions({ id, isPinned }: { id: string; isPinned: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button size="icon-xs" variant="ghost" disabled={busy} aria-label={isPinned ? "Unpin" : "Pin"} onClick={() => run(() => apiFetch(`/api/v1/announcements/${id}`, { method: "PATCH", body: { isPinned: !isPinned } }), isPinned ? "Unpinned" : "Pinned")}>{isPinned ? <PinOff /> : <Pin />}</Button>
      <Button size="icon-xs" variant="ghost" className="text-destructive" disabled={busy} aria-label="Delete" onClick={() => confirm("Delete this announcement?") && run(() => apiFetch(`/api/v1/announcements/${id}`, { method: "DELETE" }), "Deleted")}><Trash2 /></Button>
    </>
  );
}
