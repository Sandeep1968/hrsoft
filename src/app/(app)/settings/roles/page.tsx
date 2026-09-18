import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { PageHeader } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listRoles } from "@/server/services/rbac";
import { CreateRoleDialog } from "./create-role-dialog";

export const metadata = { title: "Roles & access" };

export default async function RolesPage() {
  const actor = await requireActor();
  const roles = await listRoles(actor);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Roles & access" description="Roles grant permissions at a scope (Self, Team or All). A user's effective scope is the widest across their roles." actions={<><Button variant="outline" nativeButton={false} render={<Link href="/settings/roles/matrix" />}>Permission matrix</Button><CreateRoleDialog templates={roles.filter((r) => r.key !== "SUPER_ADMIN")} /></>} />
      <div className="rounded-lg border">
        <Table>
          <TableHeader><TableRow><TableHead>Role</TableHead><TableHead>Key</TableHead><TableHead className="text-right">Permissions</TableHead><TableHead className="text-right">Users</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {roles.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/settings/roles/${r.id}`} className="font-medium hover:underline">{r.name}</Link>{r.isSystem && <Badge variant="outline" className="ml-2">system</Badge>}
                  {r.description && <div className="max-w-md whitespace-normal text-xs text-muted-foreground">{r.description}</div>}
                </TableCell>
                <TableCell className="font-mono text-xs">{r.key}</TableCell>
                <TableCell className="text-right tabular-nums">{r.permissionCount}</TableCell>
                <TableCell className="text-right tabular-nums">{r.userCount}</TableCell>
                <TableCell className="text-right"><Button size="xs" variant="ghost" nativeButton={false} render={<Link href={`/settings/roles/${r.id}`} />}>{r.key === "SUPER_ADMIN" ? "View" : "Edit"}</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
