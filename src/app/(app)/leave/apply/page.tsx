import { requireActor } from "@/lib/auth/session";
import { EmptyState, PageHeader } from "@/components/common";
import { isoDate } from "@/lib/dates";
import { getBalances, listLeaveTypes } from "@/server/services/leave";
import { todayIst } from "@/server/services/calendar";
import { db } from "@/lib/db";
import { ApplyLeaveForm } from "./apply-form";

export const metadata = { title: "Apply leave" };

export default async function ApplyLeavePage() {
  const actor = await requireActor();
  if (!actor.employeeId) {
    return (
      <div>
        <PageHeader title="Apply leave" breadcrumb={[{ label: "Leave", href: "/leave" }, { label: "Apply" }]} />
        <EmptyState title="No employee profile" description="Only employees can apply for leave." />
      </div>
    );
  }
  const today = todayIst();
  const [types, balances, me] = await Promise.all([listLeaveTypes(actor), getBalances(actor, actor.employeeId, today.getUTCFullYear()), db.employee.findUnique({ where: { id: actor.employeeId }, select: { gender: true } })]);
  const applicable = types.filter((t) => !t.applicableGender || t.applicableGender === me?.gender);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Apply leave" description="Days are counted on working days only; your manager is notified on submission." breadcrumb={[{ label: "Leave", href: "/leave" }, { label: "Apply" }]} />
      <ApplyLeaveForm types={applicable} balances={balances.map((b) => ({ leaveTypeId: b.leaveTypeId, available: b.available }))} today={isoDate(today)} />
    </div>
  );
}
