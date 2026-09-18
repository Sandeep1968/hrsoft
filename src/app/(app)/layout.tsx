import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { SessionProvider, type ClientSession } from "@/components/shell/session-provider";
import { Sidebar } from "@/components/shell/sidebar";
import { Header } from "@/components/shell/header";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect("/api/auth/logout?next=/login"); // clears a stale cookie, then goes to login

  const [user, hasReports, unread] = await Promise.all([
    db.user.findUnique({ where: { id: actor.userId }, select: { image: true, mustChangePassword: true, employee: { select: { employeeCode: true } } } }),
    actor.employeeId ? db.employee.count({ where: { managerId: actor.employeeId, status: { not: "EXITED" } } }).then((c) => c > 0) : Promise.resolve(false),
    db.notification.count({ where: { userId: actor.userId, readAt: null } }),
  ]);

  const session: ClientSession = {
    userId: actor.userId,
    email: actor.email,
    name: actor.name,
    image: user?.image,
    employeeId: actor.employeeId,
    employeeCode: user?.employee?.employeeCode,
    roles: actor.roles,
    permissions: Object.fromEntries(actor.perms),
    hasReports,
  };

  return (
    <SessionProvider session={session}>
      <div className="flex min-h-screen">
        <aside className="hidden w-60 shrink-0 border-r bg-sidebar lg:block">
          <div className="sticky top-0 h-screen">
            <Sidebar />
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <Header unread={unread} />
          {user?.mustChangePassword && (
            <div className="border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
              You are using a temporary password. <a href="/me/security" className="underline">Change it now</a>.
            </div>
          )}
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
    </SessionProvider>
  );
}
