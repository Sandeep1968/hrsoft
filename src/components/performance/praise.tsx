"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/common/native-select";
import { apiFetch } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { EmployeePicker, type PickedEmployee } from "./employee-picker";

export function GivePraiseDialog({ badges, defaultTo }: { badges: readonly string[]; defaultTo?: PickedEmployee }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [to, setTo] = useState<PickedEmployee[]>(defaultTo ? [defaultTo] : []);
  const [badge, setBadge] = useState<string>("");
  const [kind, setKind] = useState<"PRAISE" | "FEEDBACK">("PRAISE");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!to[0]) return toast.error("Pick a colleague");
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await apiFetch("/api/v1/praise", { method: "POST", body: { toId: to[0].id, message: fd.get("message"), badge: kind === "PRAISE" ? badge || null : null, kind, isPublic: kind === "PRAISE" && fd.get("isPublic") === "on" } });
      toast.success(kind === "PRAISE" ? "Praise posted" : "Feedback sent privately");
      setOpen(false);
      setTo([]);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}><Sparkles /> Give praise</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Recognise a colleague</DialogTitle>
            <DialogDescription>Praise goes on the wall; feedback is private to the recipient and their manager.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5"><Label>To</Label><EmployeePicker value={to} onChange={setTo} /></div>
          <div className="grid gap-1.5">
            <Label htmlFor="praise-kind">Type</Label>
            <NativeSelect id="praise-kind" value={kind} onChange={(e) => setKind(e.target.value as "PRAISE" | "FEEDBACK")}>
              <option value="PRAISE">Praise (public)</option>
              <option value="FEEDBACK">Private feedback</option>
            </NativeSelect>
          </div>
          {kind === "PRAISE" && (
            <div className="grid gap-1.5">
              <Label>Badge</Label>
              <div className="flex flex-wrap gap-1.5">
                {badges.map((b) => (
                  <button key={b} type="button" onClick={() => setBadge(badge === b ? "" : b)} className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", badge === b ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>{b}</button>
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-1.5"><Label htmlFor="praise-msg">Message</Label><Textarea id="praise-msg" name="message" required minLength={3} placeholder="What did they do that made a difference?" /></div>
          {kind === "PRAISE" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isPublic" defaultChecked /> Show on the praise wall</label>}
          <DialogFooter showCloseButton><Button type="submit" disabled={busy}>Send</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
