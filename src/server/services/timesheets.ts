import "server-only";
import { z } from "zod";
import { Prisma, type TimesheetStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { addDays, isoDate, toDateOnly, weekStart as mondayOf } from "@/lib/dates";
import { paginate, paginationSchema, toPage, zDateOnly, zUuid } from "@/lib/api";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { type Actor, authorize, can, requireEmployee, scopeFilter, scopeOf, visibleEmployeeIds } from "@/lib/rbac/authorize";
import { dispatchWebhook } from "@/server/services/webhooks";

// ── Schemas ────────────────────────────────────────────────────────────

export const entrySchema = z.object({
  projectId: zUuid,
  taskId: zUuid.optional().nullable(),
  date: zDateOnly,
  hours: z.coerce.number().min(0).max(24).refine((h) => Math.round(h * 4) === h * 4, "Hours must be in 0.25 steps"),
  note: z.string().trim().max(500).optional().nullable(),
  isBillable: z.boolean().default(true),
});
export const saveEntriesSchema = z.object({ entries: z.array(entrySchema).max(200) });
export type EntryInput = z.infer<typeof entrySchema>;

export const decideSchema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), note: z.string().trim().max(1000).optional() });

export const listTimesheetsSchema = paginationSchema.extend({
  status: z.enum(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"]).optional(),
  employeeId: zUuid.optional(),
  weekStart: zDateOnly.optional(),
  from: zDateOnly.optional(),
  to: zDateOnly.optional(),
});

export const weekQuerySchema = z.object({ employeeId: zUuid.optional(), weekStart: zDateOnly.optional() });

const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

// ── Helpers ────────────────────────────────────────────────────────────

function serializeSheet(t: {
  id: string;
  employeeId: string;
  weekStart: Date;
  status: TimesheetStatus;
  totalHours: Prisma.Decimal;
  submittedAt: Date | null;
  approverId: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  updatedAt: Date;
  employee?: { displayName: string; employeeCode: string; department?: { name: string } | null } | null;
  approver?: { displayName: string } | null;
  entries?: { id: string; projectId: string; taskId: string | null; date: Date; hours: Prisma.Decimal; note: string | null; isBillable: boolean }[];
}) {
  return {
    id: t.id,
    employeeId: t.employeeId,
    employeeName: t.employee?.displayName ?? null,
    employeeCode: t.employee?.employeeCode ?? null,
    department: t.employee?.department?.name ?? null,
    weekStart: isoDate(t.weekStart),
    weekEnd: isoDate(addDays(t.weekStart, 6)),
    status: t.status,
    totalHours: Number(t.totalHours),
    submittedAt: t.submittedAt?.toISOString() ?? null,
    approverId: t.approverId,
    approverName: t.approver?.displayName ?? null,
    decidedAt: t.decidedAt?.toISOString() ?? null,
    decisionNote: t.decisionNote,
    updatedAt: t.updatedAt.toISOString(),
    entries: (t.entries ?? []).map((e) => ({ id: e.id, projectId: e.projectId, taskId: e.taskId, date: isoDate(e.date), hours: Number(e.hours), note: e.note, isBillable: e.isBillable })),
  };
}
export type TimesheetDto = ReturnType<typeof serializeSheet>;

/** Projects the employee may log time against (member or manager, active/planned). */
export async function assignableProjects(employeeId: string) {
  const rows = await db.project.findMany({
    where: { status: { in: ["ACTIVE", "PLANNED"] }, OR: [{ managerId: employeeId }, { members: { some: { employeeId } } }] },
    select: { id: true, code: true, name: true, isBillable: true, managerId: true, tasks: { where: { status: { in: ["OPEN", "IN_PROGRESS"] } }, select: { id: true, name: true, isBillable: true }, orderBy: { name: "asc" } } },
    orderBy: { code: "asc" },
  });
  return rows;
}

/** True when the actor manages at least one project that appears in the sheet. */
async function managesProjectInSheet(actor: Actor, timesheetId: string): Promise<boolean> {
  if (!actor.employeeId || !can(actor, "projects:manage")) return false;
  const n = await db.timesheetEntry.count({ where: { timesheetId, project: { managerId: actor.employeeId } } });
  return n > 0;
}

// ── Read ───────────────────────────────────────────────────────────────

export async function getOrCreateWeek(actor: Actor, employeeId: string | undefined, weekStartInput: Date | undefined) {
  const target = employeeId ?? requireEmployee(actor);
  const week = mondayOf(weekStartInput ?? new Date());
  const isSelf = actor.employeeId === target;
  if (isSelf) {
    if (!can(actor, "timesheets:submit") && !can(actor, "timesheets:read")) throw new ForbiddenError("Missing permission timesheets:read");
  } else {
    await authorize(actor, "timesheets:read", { employeeId: target });
  }
  const include = { entries: { orderBy: [{ date: "asc" as const }, { projectId: "asc" as const }] }, approver: { select: { displayName: true } }, employee: { select: { displayName: true, employeeCode: true, department: { select: { name: true } } } } };
  let sheet = await db.timesheet.findUnique({ where: { employeeId_weekStart: { employeeId: target, weekStart: week } }, include });
  if (!sheet) {
    if (!isSelf && !can(actor, "timesheets:approve")) {
      // Viewers without approve rights get a virtual empty sheet instead of creating rows.
      const emp = await db.employee.findUnique({ where: { id: target }, select: { displayName: true, employeeCode: true, department: { select: { name: true } } } });
      if (!emp) throw new NotFoundError("Employee");
      const projects = await assignableProjects(target);
      return {
        timesheet: { id: null as string | null, employeeId: target, employeeName: emp.displayName, employeeCode: emp.employeeCode, department: emp.department?.name ?? null, weekStart: isoDate(week), weekEnd: isoDate(addDays(week, 6)), status: "DRAFT" as TimesheetStatus, totalHours: 0, submittedAt: null, approverId: null, approverName: null, decidedAt: null, decisionNote: null, updatedAt: new Date().toISOString(), entries: [] as TimesheetDto["entries"] },
        projects,
        canEdit: false,
        canDecide: false,
      };
    }
    sheet = await db.timesheet.upsert({ where: { employeeId_weekStart: { employeeId: target, weekStart: week } }, create: { employeeId: target, weekStart: week }, update: {}, include });
  }
  const projects = await assignableProjects(target);
  const dto = serializeSheet(sheet);
  return {
    timesheet: { ...dto, id: dto.id as string | null },
    projects,
    canEdit: isSelf && can(actor, "timesheets:submit") && (sheet.status === "DRAFT" || sheet.status === "REJECTED"),
    canDecide: sheet.status === "SUBMITTED" && (await canDecide(actor, sheet)),
  };
}

export async function getTimesheet(actor: Actor, id: string) {
  const sheet = await db.timesheet.findUnique({
    where: { id },
    include: { entries: { orderBy: [{ date: "asc" }, { projectId: "asc" }], include: { project: { select: { code: true, name: true } }, task: { select: { name: true } } } }, approver: { select: { displayName: true } }, employee: { select: { displayName: true, employeeCode: true, department: { select: { name: true } } } } },
  });
  if (!sheet) throw new NotFoundError("Timesheet");
  const allowed = actor.employeeId === sheet.employeeId ? can(actor, "timesheets:read") || can(actor, "timesheets:submit") : await authorize(actor, "timesheets:read", { employeeId: sheet.employeeId }).then(() => true).catch(async () => (await managesProjectInSheet(actor, id)) || sheet.approverId === actor.employeeId);
  if (!allowed) throw new ForbiddenError();
  const dto = serializeSheet(sheet);
  return {
    ...dto,
    entries: sheet.entries.map((e) => ({ id: e.id, projectId: e.projectId, projectCode: e.project.code, projectName: e.project.name, taskId: e.taskId, taskName: e.task?.name ?? null, date: isoDate(e.date), hours: Number(e.hours), note: e.note, isBillable: e.isBillable })),
    canDecide: sheet.status === "SUBMITTED" && (await canDecide(actor, sheet)),
  };
}

// ── Write ──────────────────────────────────────────────────────────────

export async function saveEntries(actor: Actor, timesheetId: string, entries: EntryInput[]) {
  const sheet = await db.timesheet.findUnique({ where: { id: timesheetId }, select: { id: true, employeeId: true, weekStart: true, status: true } });
  if (!sheet) throw new NotFoundError("Timesheet");
  await authorize(actor, "timesheets:submit", { employeeId: sheet.employeeId });
  if (sheet.status !== "DRAFT" && sheet.status !== "REJECTED") throw new ConflictError(`A ${sheet.status.toLowerCase()} timesheet cannot be edited`);

  const weekEnd = addDays(sheet.weekStart, 6);
  const perDay = new Map<string, number>();
  for (const e of entries) {
    const d = toDateOnly(e.date);
    if (d.getTime() < sheet.weekStart.getTime() || d.getTime() > weekEnd.getTime()) throw new ValidationError(`Entry date ${isoDate(d)} is outside the week ${isoDate(sheet.weekStart)} – ${isoDate(weekEnd)}`);
    const key = isoDate(d);
    perDay.set(key, (perDay.get(key) ?? 0) + e.hours);
  }
  for (const [day, hours] of perDay) if (hours > 24) throw new ValidationError(`Total hours on ${day} exceed 24 (${hours})`);

  const projectIds = [...new Set(entries.map((e) => e.projectId))];
  if (projectIds.length) {
    const projects = await db.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, code: true, status: true, managerId: true, members: { where: { employeeId: sheet.employeeId }, select: { employeeId: true } }, tasks: { select: { id: true } } },
    });
    const byId = new Map(projects.map((p) => [p.id, p]));
    for (const pid of projectIds) {
      const p = byId.get(pid);
      if (!p) throw new NotFoundError("Project");
      if (p.members.length === 0 && p.managerId !== sheet.employeeId) throw new ForbiddenError(`Not a member of project ${p.code}`);
      if (p.status === "COMPLETED" || p.status === "CANCELLED") throw new ValidationError(`Project ${p.code} is ${p.status.toLowerCase()}`);
    }
    for (const e of entries) {
      if (e.taskId && !byId.get(e.projectId)!.tasks.some((t) => t.id === e.taskId)) throw new ValidationError("Task does not belong to the selected project");
    }
  }

  const kept = entries.filter((e) => e.hours > 0);
  const total = kept.reduce((a, b) => a + b.hours, 0);
  const updated = await db.$transaction(async (tx) => {
    await tx.timesheetEntry.deleteMany({ where: { timesheetId } });
    if (kept.length) await tx.timesheetEntry.createMany({ data: kept.map((e) => ({ timesheetId, projectId: e.projectId, taskId: e.taskId ?? null, date: toDateOnly(e.date), hours: e.hours, note: e.note ?? null, isBillable: e.isBillable })) });
    return tx.timesheet.update({ where: { id: timesheetId }, data: { totalHours: total, status: "DRAFT" }, include: { entries: { orderBy: [{ date: "asc" }, { projectId: "asc" }] } } });
  });
  await audit(actor, "timesheets.save", "Timesheet", timesheetId, { after: { entries: kept.length, totalHours: total } });
  return serializeSheet(updated);
}

export async function submitTimesheet(actor: Actor, timesheetId: string) {
  const sheet = await db.timesheet.findUnique({ where: { id: timesheetId }, include: { entries: { select: { projectId: true, hours: true } }, employee: { select: { displayName: true, managerId: true } } } });
  if (!sheet) throw new NotFoundError("Timesheet");
  await authorize(actor, "timesheets:submit", { employeeId: sheet.employeeId });
  if (sheet.status !== "DRAFT" && sheet.status !== "REJECTED") throw new ConflictError(`Timesheet is already ${sheet.status.toLowerCase()}`);
  if (sheet.entries.length === 0) throw new ValidationError("Add at least one entry before submitting");

  // Approver: manager of the project with the most hours this week (not the employee), else line manager.
  const hoursByProject = new Map<string, number>();
  for (const e of sheet.entries) hoursByProject.set(e.projectId, (hoursByProject.get(e.projectId) ?? 0) + Number(e.hours));
  const ranked = [...hoursByProject.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const managers = await db.project.findMany({ where: { id: { in: ranked } }, select: { id: true, managerId: true } });
  let approverId: string | null = null;
  for (const pid of ranked) {
    const m = managers.find((p) => p.id === pid)?.managerId ?? null;
    if (m && m !== sheet.employeeId) {
      approverId = m;
      break;
    }
  }
  if (!approverId && sheet.employee.managerId && sheet.employee.managerId !== sheet.employeeId) approverId = sheet.employee.managerId;

  const updated = await db.timesheet.update({ where: { id: timesheetId }, data: { status: "SUBMITTED", submittedAt: new Date(), approverId, decidedAt: null, decisionNote: null }, include: { entries: true } });
  await audit(actor, "timesheets.submit", "Timesheet", timesheetId, { before: { status: sheet.status }, after: { status: "SUBMITTED", approverId, totalHours: Number(sheet.totalHours) } });
  if (approverId) {
    await notify({ employeeId: approverId, type: "timesheet.submitted", title: `Timesheet to approve: ${sheet.employee.displayName}`, body: `Week of ${isoDate(sheet.weekStart)} · ${Number(sheet.totalHours)}h`, link: `/timesheets/team?weekStart=${isoDate(sheet.weekStart)}`, email: true });
  }
  dispatchWebhook("timesheet.submitted", { id: timesheetId, employeeId: sheet.employeeId, weekStart: isoDate(sheet.weekStart), totalHours: Number(sheet.totalHours) });
  return serializeSheet(updated);
}

async function canDecide(actor: Actor, sheet: { id: string; employeeId: string }): Promise<boolean> {
  const scope = scopeOf(actor, "timesheets:approve");
  if (sheet.employeeId === actor.employeeId && scope !== "ALL") return false;
  if (scope) {
    const ok = await authorize(actor, "timesheets:approve", { employeeId: sheet.employeeId }).then(() => true).catch(() => false);
    if (ok) return true;
  }
  return managesProjectInSheet(actor, sheet.id);
}

export async function decideTimesheet(actor: Actor, timesheetId: string, input: z.infer<typeof decideSchema>) {
  const sheet = await db.timesheet.findUnique({ where: { id: timesheetId }, include: { employee: { select: { displayName: true } } } });
  if (!sheet) throw new NotFoundError("Timesheet");
  if (sheet.status !== "SUBMITTED") throw new ConflictError("Only submitted timesheets can be decided");
  if (sheet.employeeId === actor.employeeId && scopeOf(actor, "timesheets:approve") !== "ALL") throw new ForbiddenError("You cannot approve your own timesheet");
  if (!(await canDecide(actor, sheet))) throw new ForbiddenError("You are not an approver for this timesheet");

  const updated = await db.timesheet.update({
    where: { id: timesheetId },
    data: { status: input.decision, decidedAt: new Date(), decisionNote: input.note ?? null, approverId: actor.employeeId ?? sheet.approverId },
    include: { entries: true, approver: { select: { displayName: true } }, employee: { select: { displayName: true, employeeCode: true, department: { select: { name: true } } } } },
  });
  await audit(actor, `timesheets.${input.decision.toLowerCase()}`, "Timesheet", timesheetId, { before: { status: "SUBMITTED" }, after: { status: input.decision, note: input.note ?? null } });
  await notify({ employeeId: sheet.employeeId, type: "timesheet.decided", title: `Timesheet ${input.decision.toLowerCase()} for week of ${isoDate(sheet.weekStart)}`, body: input.note ?? undefined, link: `/timesheets?weekStart=${isoDate(sheet.weekStart)}`, email: true });
  dispatchWebhook("timesheet.decided", { id: timesheetId, employeeId: sheet.employeeId, weekStart: isoDate(sheet.weekStart), decision: input.decision });
  return serializeSheet(updated);
}

// ── Lists & summaries ──────────────────────────────────────────────────

export async function listTimesheets(actor: Actor, p: z.infer<typeof listTimesheetsSchema>) {
  const scoped = await scopeFilter(actor, "timesheets:read");
  const me = actor.employeeId;
  // Approvers also see the sheets routed to them, and PMs see sheets that log time on their projects.
  const extra: Prisma.TimesheetWhereInput[] = [];
  if (me && Object.keys(scoped).length > 0) {
    extra.push({ approverId: me });
    if (can(actor, "projects:manage")) extra.push({ entries: { some: { project: { managerId: me } } } });
  }
  const where: Prisma.TimesheetWhereInput = {
    AND: [
      extra.length ? { OR: [scoped as Prisma.TimesheetWhereInput, ...extra] } : (scoped as Prisma.TimesheetWhereInput),
      p.status ? { status: p.status } : {},
      p.employeeId ? { employeeId: p.employeeId } : {},
      p.weekStart ? { weekStart: mondayOf(p.weekStart) } : {},
      p.from ? { weekStart: { gte: mondayOf(p.from) } } : {},
      p.to ? { weekStart: { lte: mondayOf(p.to) } } : {},
      p.q ? { employee: { OR: [{ displayName: { contains: p.q, mode: "insensitive" } }, { employeeCode: { contains: p.q, mode: "insensitive" } }] } } : {},
    ],
  };
  const [rows, total] = await Promise.all([
    db.timesheet.findMany({
      where,
      orderBy: [{ weekStart: p.order === "asc" ? "asc" : "desc" }, { submittedAt: "desc" }],
      ...paginate(p),
      include: { employee: { select: { displayName: true, employeeCode: true, department: { select: { name: true } } } }, approver: { select: { displayName: true } } },
    }),
    db.timesheet.count({ where }),
  ]);
  return toPage(rows.map((r) => serializeSheet(r)), total, p);
}

/** Employees on active projects who have not submitted a sheet for the week. */
export async function missingTimesheets(actor: Actor, weekStartInput?: Date) {
  await authorize(actor, "timesheets:approve", { minScope: "TEAM" });
  const week = mondayOf(weekStartInput ?? addDays(new Date(), -7));
  const ids = await visibleEmployeeIds(actor, "timesheets:approve");
  const scope = ids === null ? Prisma.empty : Prisma.sql`AND e.id = ANY(${ids.length ? ids : [EMPTY_UUID]}::uuid[])`;
  const rows = await db.$queryRaw<{ employeeId: string; displayName: string; employeeCode: string; department: string | null; managerName: string | null; status: string | null; projects: number }[]>`
    SELECT e.id AS "employeeId", e."displayName", e."employeeCode", d.name AS department, m."displayName" AS "managerName",
           ts.status, COUNT(DISTINCT pm."projectId")::int AS projects
    FROM "Employee" e
      JOIN "ProjectMember" pm ON pm."employeeId" = e.id
      JOIN "Project" p ON p.id = pm."projectId" AND p.status = 'ACTIVE'
      LEFT JOIN "Department" d ON d.id = e."departmentId"
      LEFT JOIN "Employee" m ON m.id = e."managerId"
      LEFT JOIN "Timesheet" ts ON ts."employeeId" = e.id AND ts."weekStart" = ${week}::date
    WHERE e.status IN ('ACTIVE', 'ON_NOTICE') AND e."joiningDate" <= ${addDays(week, 6)}::date
      AND (ts.id IS NULL OR ts.status IN ('DRAFT', 'REJECTED')) ${scope}
    GROUP BY e.id, e."displayName", e."employeeCode", d.name, m."displayName", ts.status
    ORDER BY e."displayName"
    LIMIT 500`;
  return { weekStart: isoDate(week), weekEnd: isoDate(addDays(week, 6)), items: rows };
}

export async function weeklySummary(actor: Actor, weekStartInput?: Date) {
  const scoped = await scopeFilter(actor, "timesheets:read");
  const week = mondayOf(weekStartInput ?? new Date());
  const where: Prisma.TimesheetWhereInput = { ...(scoped as Prisma.TimesheetWhereInput), weekStart: week };
  const [byStatus, hours] = await Promise.all([
    db.timesheet.groupBy({ by: ["status"], where, _count: { _all: true }, _sum: { totalHours: true } }),
    db.timesheetEntry.aggregate({ where: { timesheet: where }, _sum: { hours: true } }).then((r) => Number(r._sum.hours ?? 0)),
  ]);
  const counts: Record<TimesheetStatus, number> = { DRAFT: 0, SUBMITTED: 0, APPROVED: 0, REJECTED: 0 };
  let total = 0;
  for (const b of byStatus) {
    counts[b.status] = b._count._all;
    total += Number(b._sum.totalHours ?? 0);
  }
  const billable = await db.timesheetEntry.aggregate({ where: { timesheet: where, isBillable: true }, _sum: { hours: true } }).then((r) => Number(r._sum.hours ?? 0));
  return { weekStart: isoDate(week), weekEnd: isoDate(addDays(week, 6)), counts, totalHours: total || hours, billableHours: billable };
}
