import { requireActor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/common";
import { fmtDateTime } from "@/lib/dates";
import { SecurityForms } from "./security-forms";

export const metadata = { title: "Security" };

export default async function SecurityPage() {
  const actor = await requireActor();
  const sessions = await db.session.findMany({ where: { userId: actor.userId, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, select: { id: true, ip: true, userAgent: true, createdAt: true }, take: 20 });
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Security" description="Change your password and manage where you are signed in." breadcrumb={[{ label: "My Profile", href: "/me" }, { label: "Security" }]} />
      <SecurityForms sessions={sessions.map((s) => ({ id: s.id, ip: s.ip, userAgent: s.userAgent, createdAt: fmtDateTime(s.createdAt) }))} />
    </div>
  );
}
