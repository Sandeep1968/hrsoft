import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader } from "@/components/common";
import { ProfileView } from "@/components/employees/profile-view";
import { getEmployee } from "@/server/services/employees";
import { getOrgLookups } from "@/server/services/org";
import { listDocuments } from "@/server/services/documents";
import { listEmployeeOnboardingTasks } from "@/server/services/onboarding";
import { listExits } from "@/server/services/exits";

export const metadata = { title: "My Profile" };

export default async function MePage({ searchParams }: PageProps<"/me">) {
  const actor = await requireActor();
  const sp = await searchParams;
  if (!actor.employeeId) {
    return (
      <div>
        <PageHeader title="My Profile" />
        <EmptyState title="No employee profile" description="This account is not linked to an employee record. Administrators can manage employees from the Directory." />
      </div>
    );
  }
  const id = actor.employeeId;
  const [profile, lookups, documents, tasks, exits] = await Promise.all([
    getEmployee(actor, id),
    getOrgLookups(actor),
    listDocuments(actor, id).catch(() => []),
    listEmployeeOnboardingTasks(actor, id).catch(() => []),
    listExits(actor, { pageSize: 5 }),
  ]);
  const myExit = exits.items.find((e) => e.status === "PENDING") ?? exits.items.find((e) => e.status === "APPROVED") ?? null;
  const hr = can(actor, "employees:write", "ALL");
  return (
    <ProfileView
      profile={profile}
      lookups={lookups}
      documents={documents}
      tasks={tasks}
      myExit={myExit}
      initialTab={typeof sp.tab === "string" ? sp.tab : undefined}
      perms={{ isSelf: true, isHr: hr, canEditAll: hr, canEditSelf: true, canSensitive: true, canDocsWrite: can(actor, "documents:write"), canExit: false }}
    />
  );
}
