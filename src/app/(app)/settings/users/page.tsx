import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { fmtDateTime } from "@/lib/dates";
import { EmptyState, PageHeader, StatCard, StatusBadge } from "@/components/common";
import { NativeSelect } from "@/components/common/native-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pager } from "@/components/psa/pager";
import { roleOptions } from "@/server/services/rbac";
import { listUsers, listUsersSchema, userStats } from "@/server/services/users";
import { InviteUserDialog } from "./invite-user-dialog";
import { UserRowActions } from "./user-row-actions";

export const metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const q = listUsersSchema.parse({ page: sp.page ?? "1", pageSize: "25", order: "asc", q: typeof sp.q === "string" && sp.q ? sp.q : undefined, status: ["INVITED", "ACTIVE", "SUSPENDED"].includes(String(sp.status)) ? sp.status : undefined, roleKey: typeof sp.roleKey === "string" && sp.roleKey ? sp.roleKey : undefined, hasEmployee: sp.hasEmployee === "0" ? "false" : undefined });
  const [page, stats, roles] = await Promise.all([listUsers(actor, q), userStats(actor), roleOptions(actor)]);
  const canRoles = can(actor, "rbac:manage");
  return (
    <div>
      <PageHeader title="Users" description="Login accounts, their roles and sessions." actions={<InviteUserDialog roles={roles} />} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active" value={stats.ACTIVE} hint={`${stats.total} total`} />
        <StatCard label="Invited" value={stats.INVITED} hint="not yet signed in" />
        <StatCard label="Suspended" value={stats.SUSPENDED} />
        <StatCard label="Login-only" value={stats.withoutEmployee} hint={`${stats.mustChangePassword} must change password`} />
      </div>
      <form method="get" className="mt-6 mb-3 flex flex-wrap items-center gap-2">
        <Input name="q" placeholder="Name, email or employee code" defaultValue={typeof sp.q === "string" ? sp.q : ""} className="w-64" />
        <NativeSelect name="status" defaultValue={String(sp.status ?? "")} className="w-36"><option value="">Any status</option><option value="ACTIVE">Active</option><option value="INVITED">Invited</option><option value="SUSPENDED">Suspended</option></NativeSelect>
        <NativeSelect name="roleKey" defaultValue={String(sp.roleKey ?? "")} className="w-44"><option value="">Any role</option>{roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</NativeSelect>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="hasEmployee" value="0" defaultChecked={sp.hasEmployee === "0"} /> Login-only</label>
        <Button type="submit" variant="outline" size="sm">Filter</Button>
      </form>
      {page.items.length === 0 ? <EmptyState title="No users match" /> : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Employee</TableHead><TableHead>Roles</TableHead><TableHead>Status</TableHead><TableHead>Last login</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {page.items.map((u) => (
                <TableRow key={u.id}>
                  <TableCell><div className="font-medium">{u.name}{u.id === actor.userId && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}</div><div className="text-xs text-muted-foreground">{u.email}</div></TableCell>
                  <TableCell>{u.employee ? <>{u.employee.employeeCode}<div className="text-xs text-muted-foreground">{u.employee.department ?? ""}</div></> : <span className="text-xs text-muted-foreground">login-only</span>}</TableCell>
                  <TableCell className="max-w-56 whitespace-normal"><div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r.key} variant={r.isSystem ? "secondary" : "outline"} title={r.name}>{r.key}</Badge>)}</div></TableCell>
                  <TableCell><StatusBadge status={u.status} />{u.mustChangePassword && <div className="text-[10px] text-amber-700">temp password</div>}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDateTime(u.lastLoginAt)}</TableCell>
                  <TableCell className="text-right"><UserRowActions user={u} roles={roles} canManageRoles={canRoles} isSelf={u.id === actor.userId} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pager page={page.page} pages={page.pages} total={page.total} basePath="/settings/users" params={sp} />
    </div>
  );
}
