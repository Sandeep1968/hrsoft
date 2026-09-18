"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/client/api";
import { Field } from "@/components/employees/field";

export function SecurityForms({ sessions }: { sessions: { id: string; ip: string | null; userAgent: string | null; createdAt: string }[] }) {
  const router = useRouter();
  const [f, setF] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [busy, setBusy] = useState<"pw" | "revoke" | null>(null);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (f.newPassword !== f.confirm) return toast.error("Passwords do not match");
    setBusy("pw");
    try {
      await apiFetch("/api/auth/change-password", { method: "POST", body: { currentPassword: f.currentPassword, newPassword: f.newPassword } });
      toast.success("Password changed");
      setF({ currentPassword: "", newPassword: "", confirm: "" });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change password");
    } finally {
      setBusy(null);
    }
  }
  async function revokeOthers() {
    setBusy("revoke");
    try {
      const r = await apiFetch<{ revoked: number }>("/api/auth/sessions/revoke-others", { method: "POST" });
      toast.success(`Signed out ${r.revoked} other session${r.revoked === 1 ? "" : "s"}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not revoke sessions");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Change password</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="grid gap-3 sm:max-w-sm">
            <Field label="Current password"><Input type="password" autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} /></Field>
            <Field label="New password" hint="At least 10 characters with letters and numbers"><Input type="password" autoComplete="new-password" required minLength={10} value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /></Field>
            <Field label="Confirm new password"><Input type="password" autoComplete="new-password" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
            <div><Button type="submit" disabled={busy === "pw"}>{busy === "pw" ? "Saving…" : "Change password"}</Button></div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Active sessions</CardTitle>
          <Button variant="outline" size="sm" disabled={busy === "revoke" || sessions.length <= 1} onClick={revokeOthers}>Sign out other sessions</Button>
        </CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2">
                <span className="truncate text-muted-foreground">{s.userAgent ?? "Unknown device"}</span>
                <span className="ml-4 shrink-0 text-xs text-muted-foreground">{s.ip ?? ""} · {s.createdAt}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
