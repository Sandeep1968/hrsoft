"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/common/native-select";
import { apiFetch, ApiError } from "@/lib/client/api";
import type { RoleDetail } from "@/server/services/rbac";

interface Group { module: string; label: string; permissions: { permission: string; description: string }[] }
type Scope = "" | "SELF" | "TEAM" | "ALL";

export function RoleEditor({ role, groups }: { role: RoleDetail; groups: Group[] }) {
  const router = useRouter();
  const readOnly = role.isImmutable;
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [scopes, setScopes] = useState<Record<string, Scope>>(() => Object.fromEntries(role.grants.map((g) => [g.permission, g.scope])));
  const [busy, setBusy] = useState(false);
  const granted = useMemo(() => Object.values(scopes).filter(Boolean).length, [scopes]);

  function setModule(g: Group, scope: Scope) {
    setScopes((s) => ({ ...s, ...Object.fromEntries(g.permissions.map((p) => [p.permission, scope])) }));
  }
  async function save() {
    setBusy(true);
    try {
      const grants = Object.entries(scopes).filter(([, s]) => s).map(([permission, scope]) => ({ permission, scope }));
      await apiFetch(`/api/v1/roles/${role.id}`, { method: "PATCH", body: readOnly ? { name, description: description || null } : { name, description: description || null, grants } });
      toast.success("Role saved");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save role");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm(`Delete role ${role.key}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/roles/${role.id}`, { method: "DELETE" });
      toast.success("Role deleted");
      router.push("/settings/roles");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not delete role");
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
        <div className="grid gap-1.5"><Label htmlFor="role-name">Name</Label><Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label>Key</Label><Input value={role.key} disabled /></div>
        <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="role-desc">Description</Label><Textarea id="role-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      </div>
      {readOnly && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">SUPER_ADMIN permissions are immutable — every permission is granted at All scope. Only the name and description can be changed.</div>}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs"><tr><th className="px-3 py-2 text-left font-medium">Permission</th><th className="px-3 py-2 text-left font-medium">Description</th><th className="w-36 px-3 py-2 text-left font-medium">Scope</th></tr></thead>
          <tbody>
            {groups.map((g) => (
              <ModuleRows key={g.module} g={g} scopes={scopes} readOnly={readOnly} onChange={(p, s) => setScopes({ ...scopes, [p]: s })} onModule={(s) => setModule(g, s)} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{granted} permission{granted === 1 ? "" : "s"} granted · {role.userCount} user{role.userCount === 1 ? "" : "s"}</span>
        <div className="flex gap-2">
          {!role.isSystem && <Button variant="destructive" onClick={remove} disabled={busy || role.userCount > 0} title={role.userCount > 0 ? "Remove the role from all users first" : undefined}><Trash2 /> Delete role</Button>}
          <Button onClick={save} disabled={busy}><Save /> {busy ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </div>
  );
}

function ModuleRows({ g, scopes, readOnly, onChange, onModule }: { g: Group; scopes: Record<string, Scope>; readOnly: boolean; onChange: (p: string, s: Scope) => void; onModule: (s: Scope) => void }) {
  return (
    <>
      <tr className="border-t bg-muted/30">
        <td className="px-3 py-1.5 font-medium" colSpan={2}>{g.label}</td>
        <td className="px-3 py-1.5">
          {!readOnly && (
            <NativeSelect className="h-7 text-xs" value="" onChange={(e) => onModule((e.target.value === "NONE" ? "" : e.target.value) as Scope)} aria-label={`Set all ${g.label}`}>
              <option value="">Set all…</option><option value="ALL">All</option><option value="TEAM">Team</option><option value="SELF">Self</option><option value="NONE">None</option>
            </NativeSelect>
          )}
        </td>
      </tr>
      {g.permissions.map((p) => (
        <tr key={p.permission} className="border-t">
          <td className="px-3 py-1.5 font-mono text-xs">{p.permission}</td>
          <td className="px-3 py-1.5 text-muted-foreground">{p.description}</td>
          <td className="px-3 py-1.5">
            <NativeSelect className="h-7" value={scopes[p.permission] ?? ""} disabled={readOnly} onChange={(e) => onChange(p.permission, e.target.value as Scope)}>
              <option value="">None</option><option value="SELF">Self</option><option value="TEAM">Team</option><option value="ALL">All</option>
            </NativeSelect>
          </td>
        </tr>
      ))}
    </>
  );
}
