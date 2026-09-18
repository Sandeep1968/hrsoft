import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { type Actor, authorize, can } from "@/lib/rbac/authorize";
import type { Permission } from "@/lib/rbac/permissions";
import { AppError } from "@/lib/errors";
import { EmptyState, PageHeader } from "@/components/common";
import { ProfileView } from "@/components/employees/profile-view";
import { getEmployee } from "@/server/services/employees";
import { getOrgLookups } from "@/server/services/org";
import { listDocuments } from "@/server/services/documents";
import { listEmployeeOnboardingTasks } from "@/server/services/onboarding";
import { listExits } from "@/server/services/exits";

export const metadata = { title: "Employee" };

async function allowed(actor: Actor, permission: Permission, employeeId: string) {
  try {
    await authorize(actor, permission, { employeeId });
    return true;
  } catch {
    return false;
  }
}

export default async function EmployeePage({ params, searchParams }: PageProps<"/employees/[id]">) {
  const actor = await requireActor();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let profile;
  try {
    profile = await getEmployee(actor, id);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    if (e instanceof AppError && e.status === 403) {
      return (
        <div>
          <PageHeader title="Employee" />
          <EmptyState title="Not visible to you" description="You can only view employees in your team." />
        </div>
      );
    }
    throw e;
  }
  const isSelf = actor.employeeId === id;
  const [lookups, documents, tasks, exits, canEditAll, canDocsWrite, canExit] = await Promise.all([
    getOrgLookups(actor),
    listDocuments(actor, id).catch(() => []),
    listEmployeeOnboardingTasks(actor, id).catch(() => []),
    can(actor, "exits:manage") ? listExits(actor, { employeeId: id, pageSize: 5 }) : isSelf ? listExits(actor, { pageSize: 5 }) : Promise.resolve({ items: [] }),
    allowed(actor, "employees:write", id),
    allowed(actor, "documents:write", id),
    allowed(actor, "employees:delete", id),
  ]);
  const myExit = exits.items.find((e) => e.status === "PENDING") ?? exits.items.find((e) => e.status === "APPROVED") ?? null;
  return (
    <div>
      <div className="mb-2 text-xs text-muted-foreground">
        <Link href="/employees" className="hover:underline">Directory</Link> / {profile.employeeCode}
      </div>
      <ProfileView
        profile={profile}
        lookups={lookups}
        documents={documents}
        tasks={tasks}
        myExit={myExit}
        initialTab={typeof sp.tab === "string" ? sp.tab : undefined}
        perms={{ isSelf, isHr: can(actor, "employees:write", "ALL"), canEditAll, canEditSelf: isSelf, canSensitive: canEditAll || isSelf, canDocsWrite, canExit }}
      />
    </div>
  );
}
