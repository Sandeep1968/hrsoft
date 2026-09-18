"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/common/native-select";
import { apiFetch, ApiError } from "@/lib/client/api";
import { fmtDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { TicketDetail } from "@/server/services/helpdesk";

const STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_ON_EMPLOYEE", "RESOLVED", "CLOSED"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

export function TicketThread({ ticket }: { ticket: TicketDetail }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [agents, setAgents] = useState<{ id: string; displayName: string; openTickets: number }[]>([]);
  const closed = ticket.status === "CLOSED";

  useEffect(() => {
    if (ticket.viewerIsAgent) apiFetch<{ id: string; displayName: string; openTickets: number }[]>("/api/v1/helpdesk/agents").then(setAgents).catch(() => setAgents([]));
  }, [ticket.viewerIsAgent]);

  async function patch(data: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    try {
      await apiFetch(`/api/v1/tickets/${ticket.id}`, { method: "PATCH", body: data });
      toast.success(okMsg);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not update ticket");
    } finally {
      setBusy(false);
    }
  }
  async function comment(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/tickets/${ticket.id}/comments`, { method: "POST", body: { body, isInternal: internal } });
      setBody("");
      setInternal(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not post comment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <ol className="space-y-3">
          <li className="rounded-lg border p-3">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground"><span className="font-medium text-foreground">{ticket.raiser.displayName}</span><span>{fmtDateTime(ticket.createdAt)}</span></div>
            <p className="whitespace-pre-wrap text-sm">{ticket.description}</p>
          </li>
          {ticket.comments.map((c) => (
            <li key={c.id} className={cn("rounded-lg border p-3", c.isInternal ? "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/40" : c.isAgent ? "bg-muted/40" : "")}>
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1 font-medium text-foreground">{c.author.displayName}{c.isAgent && <span className="rounded bg-primary/10 px-1 text-[10px] uppercase text-primary">agent</span>}{c.isInternal && <span className="flex items-center gap-0.5 text-amber-700 dark:text-amber-300"><Lock className="size-3" /> internal</span>}</span>
                <span>{fmtDateTime(c.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm">{c.body}</p>
            </li>
          ))}
        </ol>
        {closed ? (
          <div className="mt-3 flex items-center justify-between rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            <span>This ticket is closed.</span>
            {ticket.viewerIsRaiser && <Button size="sm" variant="outline" disabled={busy} onClick={() => patch({ status: "OPEN" }, "Ticket reopened")}>Reopen</Button>}
          </div>
        ) : (
          <form onSubmit={comment} className="mt-3 grid gap-2">
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder={internal ? "Internal note (hidden from the employee)" : "Write a reply…"} className={internal ? "border-amber-300" : ""} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              {ticket.viewerIsAgent ? <label className="flex items-center gap-2 text-sm"><Checkbox checked={internal} onCheckedChange={(v) => setInternal(Boolean(v))} /> Internal note</label> : <span />}
              <div className="flex gap-2">
                {ticket.viewerIsRaiser && ticket.status === "RESOLVED" && <Button type="button" variant="outline" disabled={busy} onClick={() => patch({ status: "CLOSED" }, "Ticket closed")}>Close ticket</Button>}
                {ticket.viewerIsRaiser && !ticket.viewerIsAgent && ticket.status !== "RESOLVED" && <Button type="button" variant="ghost" disabled={busy} onClick={() => patch({ status: "CLOSED" }, "Ticket closed")}>Close</Button>}
                <Button type="submit" disabled={busy || !body.trim()}><Send /> {internal ? "Add note" : "Reply"}</Button>
              </div>
            </div>
          </form>
        )}
      </div>

      {ticket.viewerIsAgent && (
        <aside className="space-y-3 rounded-lg border p-3 text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Agent controls</div>
          <label className="grid gap-1">Status<NativeSelect value={ticket.status} disabled={busy} onChange={(e) => patch({ status: e.target.value }, `Status → ${e.target.value.replaceAll("_", " ")}`)}>{STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</NativeSelect></label>
          <label className="grid gap-1">Priority<NativeSelect value={ticket.priority} disabled={busy} onChange={(e) => patch({ priority: e.target.value }, `Priority → ${e.target.value}`)}>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</NativeSelect></label>
          <label className="grid gap-1">
            Assignee
            <NativeSelect value={ticket.assignee?.id ?? ""} disabled={busy} onChange={(e) => patch({ assigneeId: e.target.value || null }, e.target.value ? "Assigned" : "Unassigned")}>
              <option value="">Unassigned</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.displayName} ({a.openTickets} open)</option>)}
            </NativeSelect>
          </label>
          {!ticket.canManage && <p className="text-xs text-muted-foreground">Agents can only assign tickets to themselves.</p>}
        </aside>
      )}
    </div>
  );
}
