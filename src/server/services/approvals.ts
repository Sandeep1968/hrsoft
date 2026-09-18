import "server-only";
import { db } from "@/lib/db";
import { isoDate } from "@/lib/dates";
import { can, visibleEmployeeIds, type Actor } from "@/lib/rbac/authorize";
import type { Permission } from "@/lib/rbac/permissions";

/**
 * Unified approvals inbox. Reads other modules' tables read-only and returns
 * items whose `decideUrl` follows the shared contract
 * `POST /api/v1/<resource>/:id/decide { decision, note? }`.
 */

export type ApprovalType = "leave" | "regularization" | "remote_work" | "expense" | "timesheet" | "exit";

export interface ApprovalItem {
  type: ApprovalType;
  id: string;
  employee: { id: string; displayName: string; employeeCode: string; photoUrl: string | null };
  title: string;
  subtitle: string;
  amountOrDays: number | null;
  submittedAt: string;
  decideUrl: string;
  /** Where to look at the underlying entity. */
  link: string;
}

const employeeLite = { select: { id: true, displayName: true, employeeCode: true, photoUrl: true } } as const;

const TYPE_PERMISSION: Record<ApprovalType, Permission> = {
  leave: "leave:approve",
  regularization: "attendance:approve",
  remote_work: "attendance:approve",
  expense: "expenses:approve",
  timesheet: "timesheets:approve",
  exit: "exits:manage",
};

async function scopeFor(actor: Actor, perm: Permission): Promise<{ employeeId?: { in: string[] } } | null> {
  if (!can(actor, perm)) return null;
  const ids = await visibleEmployeeIds(actor, perm);
  if (ids === null) return {};
  // Never let someone approve their own request from the inbox.
  const others = ids.filter((id) => id !== actor.employeeId);
  return { employeeId: { in: others } };
}

export async function listPendingApprovals(actor: Actor, opts: { limitPerType?: number } = {}) {
  const take = Math.min(opts.limitPerType ?? 100, 500);
  const [leaveScope, attScope, expScope, tsScope, exitScope] = await Promise.all([
    scopeFor(actor, TYPE_PERMISSION.leave),
    scopeFor(actor, TYPE_PERMISSION.regularization),
    scopeFor(actor, TYPE_PERMISSION.expense),
    scopeFor(actor, TYPE_PERMISSION.timesheet),
    scopeFor(actor, TYPE_PERMISSION.exit),
  ]);

  const [leaves, regs, remotes, expenses, timesheets, exits, counts] = await Promise.all([
    leaveScope ? db.leaveRequest.findMany({ where: { status: "PENDING", ...leaveScope }, orderBy: { createdAt: "asc" }, take, include: { employee: employeeLite, leaveType: { select: { name: true, code: true } } } }) : [],
    attScope ? db.regularizationRequest.findMany({ where: { status: "PENDING", ...attScope }, orderBy: { createdAt: "asc" }, take, include: { employee: employeeLite } }) : [],
    attScope ? db.remoteWorkRequest.findMany({ where: { status: "PENDING", ...attScope }, orderBy: { createdAt: "asc" }, take, include: { employee: employeeLite } }) : [],
    expScope ? db.expenseClaim.findMany({ where: { status: "SUBMITTED", ...expScope }, orderBy: { submittedAt: "asc" }, take, include: { employee: employeeLite } }) : [],
    tsScope ? db.timesheet.findMany({ where: { status: "SUBMITTED", ...tsScope }, orderBy: { submittedAt: "asc" }, take, include: { employee: employeeLite } }) : [],
    exitScope ? db.exitRequest.findMany({ where: { status: "PENDING", ...exitScope }, orderBy: { createdAt: "asc" }, take, include: { employee: employeeLite } }) : [],
    Promise.all([
      leaveScope ? db.leaveRequest.count({ where: { status: "PENDING", ...leaveScope } }) : 0,
      attScope ? db.regularizationRequest.count({ where: { status: "PENDING", ...attScope } }) : 0,
      attScope ? db.remoteWorkRequest.count({ where: { status: "PENDING", ...attScope } }) : 0,
      expScope ? db.expenseClaim.count({ where: { status: "SUBMITTED", ...expScope } }) : 0,
      tsScope ? db.timesheet.count({ where: { status: "SUBMITTED", ...tsScope } }) : 0,
      exitScope ? db.exitRequest.count({ where: { status: "PENDING", ...exitScope } }) : 0,
    ]),
  ]);

  const items: ApprovalItem[] = [
    ...leaves.map((r): ApprovalItem => ({
      type: "leave",
      id: r.id,
      employee: r.employee,
      title: `${r.leaveType.name} · ${Number(r.days)} day${Number(r.days) === 1 ? "" : "s"}`,
      subtitle: `${isoDate(r.startDate)} → ${isoDate(r.endDate)} · ${r.reason}`,
      amountOrDays: Number(r.days),
      submittedAt: r.createdAt.toISOString(),
      decideUrl: `/api/v1/leave-requests/${r.id}/decide`,
      link: `/leave/admin?tab=requests&id=${r.id}`,
    })),
    ...regs.map((r): ApprovalItem => ({
      type: "regularization",
      id: r.id,
      employee: r.employee,
      title: `Regularisation · ${isoDate(r.date)}`,
      subtitle: `${fmtTime(r.requestedIn)} → ${fmtTime(r.requestedOut)} · ${r.reason}`,
      amountOrDays: null,
      submittedAt: r.createdAt.toISOString(),
      decideUrl: `/api/v1/regularizations/${r.id}/decide`,
      link: `/attendance/employee/${r.employeeId}?date=${isoDate(r.date)}`,
    })),
    ...remotes.map((r): ApprovalItem => ({
      type: "remote_work",
      id: r.id,
      employee: r.employee,
      title: `Work from home · ${isoDate(r.fromDate)}${r.fromDate.getTime() !== r.toDate.getTime() ? ` → ${isoDate(r.toDate)}` : ""}`,
      subtitle: r.reason,
      amountOrDays: Math.round((r.toDate.getTime() - r.fromDate.getTime()) / 86_400_000) + 1,
      submittedAt: r.createdAt.toISOString(),
      decideUrl: `/api/v1/remote-work-requests/${r.id}/decide`,
      link: `/attendance/employee/${r.employeeId}?date=${isoDate(r.fromDate)}`,
    })),
    ...expenses.map((r): ApprovalItem => ({
      type: "expense",
      id: r.id,
      employee: r.employee,
      title: `Expense · ${r.title}`,
      subtitle: `${r.currency} ${Number(r.totalAmount).toLocaleString("en-IN")}`,
      amountOrDays: Number(r.totalAmount),
      submittedAt: (r.submittedAt ?? r.createdAt).toISOString(),
      decideUrl: `/api/v1/expense-claims/${r.id}/decide`,
      link: `/expenses/${r.id}`,
    })),
    ...timesheets.map((r): ApprovalItem => ({
      type: "timesheet",
      id: r.id,
      employee: r.employee,
      title: `Timesheet · week of ${isoDate(r.weekStart)}`,
      subtitle: `${Number(r.totalHours)} hours`,
      amountOrDays: Number(r.totalHours),
      submittedAt: (r.submittedAt ?? r.updatedAt).toISOString(),
      decideUrl: `/api/v1/timesheets/${r.id}/decide`,
      link: `/timesheets/${r.id}`,
    })),
    ...exits.map((r): ApprovalItem => ({
      type: "exit",
      id: r.id,
      employee: r.employee,
      title: `Resignation · LWD ${isoDate(r.lastWorkingDay)}`,
      subtitle: r.reason,
      amountOrDays: null,
      submittedAt: r.createdAt.toISOString(),
      decideUrl: `/api/v1/exit-requests/${r.id}/decide`,
      link: `/exits/${r.id}`,
    })),
  ];
  items.sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1));

  const [leave, regularization, remote_work, expense, timesheet, exit] = counts;
  const countsByType: Record<ApprovalType, number> = { leave, regularization, remote_work, expense, timesheet, exit };
  return { items, counts: countsByType, total: Object.values(countsByType).reduce((a, b) => a + b, 0) };
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}
