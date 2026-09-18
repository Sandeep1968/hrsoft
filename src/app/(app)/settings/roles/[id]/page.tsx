import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/dates";
import { PageHeader, StatusBadge } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pager } from "@/components/psa/pager";
import { getRole, permissionGroups, usersWithRole } from "@/server/services/rbac";
import { RoleEditor } from "./role-editor";

export const metadata = { title: "Role" };

export default async function RolePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor();
  const { id } = await params;
  const sp = await searchParams;
  const tab = sp.tab === "users" ? "users" : "permissions";
  let role;
  try {
    role = await getRole(actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const users = tab === "users" ? await usersWithRole(actor, id, { page: Number(sp.page ?? 1), pageSize: 25 }) : null;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={role.name} description={role.description ?? undefined} breadcrumb={[{ label: "Roles & access", href: "/settings/roles" }, { label: role.key }]} actions={<>{role.isSystem && <Badge variant="outline">system role</Badge>}<span className="font-mono text-xs text-muted-foreground">{role.key}</span></>} />
      <div className="mb-4 flex gap-1 rounded-lg bg-muted p-0.5 text-sm w-fit">
        <Link href={`/settings/roles/${id}`} className={`rounded-md px-3 py-1 ${tab === "permissions" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>Permissions ({role.grants.length})</Link>
        <Link href={`/settings/roles/${id}?tab=users`} className={`rounded-md px-3 py-1 ${tab === "users" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>Users ({role.userCount})</Link>
      </div>
      {tab === "permissions" ? <RoleEditor key={role.updatedAt} role={role} groups={permissionGroups()} /> : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Employee</TableHead><TableHead>Status</TableHead><TableHead>Last login</TableHead><TableHead>Assigned</TableHead></TableRow></TableHeader>
            <TableBody>
              {users!.items.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">No users have this role.</TableCell></TableRow>}
              {users!.items.map((u) => (
                <TableRow key={u.userId}>
                  <TableCell><Link href={`/settings/users?q=${encodeURIComponent(u.email)}`} className="font-medium hover:underline">{u.name}</Link><div className="text-xs text-muted-foreground">{u.email}</div></TableCell>
                  <TableCell>{u.employeeCode ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell><StatusBadge status={u.status} /></TableCell>
                  <TableCell className="text-muted-foreground">{fmtDateTime(u.lastLoginAt)}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDateTime(u.assignedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="px-3 pb-3"><Pager page={users!.page} pages={users!.pages} total={users!.total} basePath={`/settings/roles/${id}`} params={{ ...sp, tab: "users" }} /></div>
        </div>
      )}
    </div>
  );
}
