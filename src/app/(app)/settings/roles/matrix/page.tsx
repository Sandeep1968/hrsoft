import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { PageHeader } from "@/components/common";
import { permissionMatrix } from "@/server/services/rbac";
import { cn } from "@/lib/utils";

export const metadata = { title: "Permission matrix" };

const TONE: Record<string, string> = { ALL: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100", TEAM: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100", SELF: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100" };

export default async function MatrixPage() {
  const actor = await requireActor();
  const m = await permissionMatrix(actor);
  return (
    <div>
      <PageHeader title="Permission matrix" description="Every permission by role. A = All, T = Team, S = Self." breadcrumb={[{ label: "Roles & access", href: "/settings/roles" }, { label: "Matrix" }]} />
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur">
            <tr>
              <th className="sticky left-0 bg-muted/80 px-3 py-2 text-left font-medium">Permission</th>
              {m.roles.map((r) => <th key={r.id} className="px-2 py-2 text-center font-medium"><Link href={`/settings/roles/${r.id}`} className="hover:underline" title={r.name}>{r.key}</Link></th>)}
            </tr>
          </thead>
          <tbody>
            {m.modules.map((g) => (
              <ModuleBlock key={g.module} label={g.label} permissions={g.permissions} roles={m.roles} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ModuleBlock({ label, permissions, roles }: { label: string; permissions: { permission: string; description: string; scopes: Record<string, string | null> }[]; roles: { key: string }[] }) {
  return (
    <>
      <tr className="border-t bg-muted/30"><td className="sticky left-0 bg-muted/30 px-3 py-1.5 font-medium" colSpan={roles.length + 1}>{label}</td></tr>
      {permissions.map((p) => (
        <tr key={p.permission} className="border-t">
          <td className="sticky left-0 bg-background px-3 py-1 font-mono" title={p.description}>{p.permission}</td>
          {roles.map((r) => {
            const s = p.scopes[r.key];
            return <td key={r.key} className="px-2 py-1 text-center"><span className={cn("inline-block w-6 rounded py-0.5 font-medium", s ? TONE[s] : "text-muted-foreground/40")}>{s ? s[0] : "·"}</span></td>;
          })}
        </tr>
      ))}
    </>
  );
}
