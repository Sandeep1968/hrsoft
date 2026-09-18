"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { apiFetch, ApiError } from "@/lib/client/api";
import { fmtDateTime } from "@/lib/dates";
import type { UserDto } from "@/server/services/users";
import { TempPasswordBox } from "./temp-password";

interface SessionRow { id: string; ip: string | null; userAgent: string | null; createdAt: string; expiresAt: string; isExpired: boolean }

export function UserRowActions({ user, roles, canManageRoles, isSelf }: { user: UserDto; roles: { key: string; name: string; isSystem: boolean }[]; canManageRoles: boolean; isSelf: boolean }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"roles" | "reset" | "sessions" | null>(null);
  const [keys, setKeys] = useState<string[]>(user.roles.map((r) => r.key));
  const [temp, setTemp] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  async function openSessions() {
    setDialog("sessions");
    setSessions(null);
    setSessions(await apiFetch<SessionRow[]>(`/api/v1/users/${user.id}/sessions`).catch(() => []));
  }
  async function resetPassword() {
    setBusy(true);
    try {
      const r = await apiFetch<{ tempPassword: string }>(`/api/v1/users/${user.id}/reset-password`, { method: "POST" });
      setTemp(r.tempPassword);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not reset password");
      setDialog(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="icon-xs" variant="ghost" aria-label="Actions" />}><MoreHorizontal /></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {canManageRoles && <DropdownMenuItem onClick={() => { setKeys(user.roles.map((r) => r.key)); setDialog("roles"); }}>Edit roles</DropdownMenuItem>}
          <DropdownMenuItem onClick={() => { setTemp(null); setDialog("reset"); }} disabled={user.status === "SUSPENDED"}>Reset password</DropdownMenuItem>
          <DropdownMenuItem onClick={openSessions}>Sessions ({user.sessionCount})</DropdownMenuItem>
          <DropdownMenuSeparator />
          {user.status === "SUSPENDED" ? (
            <DropdownMenuItem onClick={() => call(() => apiFetch(`/api/v1/users/${user.id}`, { method: "PATCH", body: { status: "ACTIVE" } }), "User reactivated")}>Reactivate</DropdownMenuItem>
          ) : (
            <DropdownMenuItem variant="destructive" disabled={isSelf} onClick={() => confirm(`Suspend ${user.email}? All their sessions and API keys will be revoked.`) && call(() => apiFetch(`/api/v1/users/${user.id}`, { method: "PATCH", body: { status: "SUSPENDED" } }), "User suspended")}>Suspend</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          {dialog === "roles" && (
            <>
              <DialogHeader><DialogTitle>Roles · {user.name}</DialogTitle><DialogDescription>Replaces the user&apos;s role set. Their effective permissions are the widest scope across the selected roles.</DialogDescription></DialogHeader>
              <div className="grid gap-1 rounded-lg border p-2 text-sm sm:grid-cols-2">
                {roles.map((r) => <label key={r.key} className="flex items-center gap-2"><Checkbox checked={keys.includes(r.key)} onCheckedChange={(v) => setKeys(v ? [...keys, r.key] : keys.filter((k) => k !== r.key))} /> {r.name}{r.isSystem ? "" : " *"}</label>)}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(null)} disabled={busy}>Cancel</Button>
                <Button disabled={busy} onClick={() => call(() => apiFetch(`/api/v1/users/${user.id}/roles`, { method: "PUT", body: { roleKeys: keys } }), "Roles updated").then(() => setDialog(null))}>Save roles</Button>
              </DialogFooter>
            </>
          )}
          {dialog === "reset" && (
            <>
              <DialogHeader><DialogTitle>Reset password · {user.name}</DialogTitle><DialogDescription>{temp ? "The temporary password was emailed to the user and is shown once below. They must change it at next sign-in." : "Generates a temporary password, signs the user out everywhere and emails them the new password."}</DialogDescription></DialogHeader>
              {temp && <TempPasswordBox value={temp} />}
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(null)} disabled={busy}>{temp ? "Done" : "Cancel"}</Button>
                {!temp && <Button variant="destructive" onClick={resetPassword} disabled={busy}>{busy ? "Resetting…" : "Reset password"}</Button>}
              </DialogFooter>
            </>
          )}
          {dialog === "sessions" && (
            <>
              <DialogHeader><DialogTitle>Sessions · {user.name}</DialogTitle><DialogDescription>Active browser sessions. Revoking signs the user out on every device.</DialogDescription></DialogHeader>
              {sessions === null ? <p className="text-sm text-muted-foreground">Loading…</p> : sessions.length === 0 ? <p className="text-sm text-muted-foreground">No sessions.</p> : (
                <ul className="max-h-64 divide-y overflow-auto rounded-lg border text-xs">
                  {sessions.map((s) => <li key={s.id} className="p-2"><div className="flex justify-between"><span>{s.ip ?? "unknown IP"}</span><span className={s.isExpired ? "text-muted-foreground" : "text-emerald-700"}>{s.isExpired ? "expired" : `until ${fmtDateTime(s.expiresAt)}`}</span></div><div className="truncate text-muted-foreground">{s.userAgent ?? "—"} · {fmtDateTime(s.createdAt)}</div></li>)}
                </ul>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(null)} disabled={busy}>Close</Button>
                <Button variant="destructive" disabled={busy || !sessions?.length} onClick={() => call(() => apiFetch(`/api/v1/users/${user.id}/sessions`, { method: "DELETE" }), "Sessions revoked").then(openSessions)}>Revoke all</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
