import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { Prisma, type LeaveType } from "@/generated/prisma/client";
import { paginate, paginationSchema, toPage, zDateOnly, zUuid } from "@/lib/api";
import { audit } from "@/lib/audit";
import { eachDay, isoDate } from "@/lib/dates";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { notify } from "@/lib/notify";
import { authorize, requireEmployee, scopeFilter, visibleEmployeeIds, type Actor } from "@/lib/rbac/authorize";
import { countLeaveDays, getEmployeeCalendarContext, isWorkingDay, todayIst, upcomingHolidays } from "@/server/services/calendar";

// ── Schemas ──────────────────────────────────────────────────────────────

const half = z.enum(["FIRST_HALF", "SECOND_HALF"]).nullable().optional();

export const leaveTypeSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{1,10}$/, "Code must be 1-10 uppercase letters/digits"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#2563eb"),
  isPaid: z.boolean().default(true),
  annualQuota: z.number().min(0).max(999).default(0),
  accrualPerMonth: z.number().min(0).max(99).default(0),
  carryForwardMax: z.number().min(0).max(999).default(0),
  maxConsecutiveDays: z.number().int().min(1).max(365).nullable().optional(),
  allowHalfDay: z.boolean().default(true),
  allowNegative: z.boolean().default(false),
  applicableGender: z.enum(["MALE", "FEMALE", "OTHER", "UNDISCLOSED"]).nullable().optional(),
  minNoticeDays: z.number().int().min(0).max(365).default(0),
  requiresDocAfterDays: z.number().int().min(1).max(365).nullable().optional(),
  isEncashable: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export const leaveTypePatchSchema = leaveTypeSchema.partial();

export const leavePreviewSchema = z.object({
  leaveTypeId: zUuid,
  startDate: zDateOnly,
  endDate: zDateOnly,
  startHalf: half,
  endHalf: half,
  employeeId: zUuid.optional(),
});

export const applyLeaveSchema = leavePreviewSchema.extend({
  reason: z.string().trim().min(3).max(1000),
  attachmentKey: z.string().trim().max(500).optional(),
});

export const leaveListSchema = paginationSchema.extend({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  employeeId: zUuid.optional(),
  departmentId: zUuid.optional(),
  leaveTypeId: zUuid.optional(),
  from: zDateOnly.optional(),
  to: zDateOnly.optional(),
});

export const decideSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().max(500).optional(),
});

export const adjustBalanceSchema = z.object({
  employeeId: zUuid,
  leaveTypeId: zUuid,
  year: z.number().int().min(2000).max(2100),
  delta: z.number().min(-365).max(365).refine((n) => n !== 0, "Delta cannot be zero"),
  reason: z.string().trim().min(3).max(500),
});

export const balancesQuerySchema = z.object({ employeeId: zUuid.optional(), employeeCode: z.string().trim().max(120).optional(), year: z.coerce.number().int().min(2000).max(2100).optional() });

export const calendarQuerySchema = z.object({ from: zDateOnly, to: zDateOnly, departmentId: zUuid.optional() });

// ── Helpers ──────────────────────────────────────────────────────────────

const employeeLite = { select: { id: true, displayName: true, employeeCode: true, photoUrl: true, gender: true, managerId: true, department: { select: { id: true, name: true } } } } as const;
const typeLite = { select: { id: true, name: true, code: true, color: true, isPaid: true } } as const;

const n = (d: Prisma.Decimal | number | null | undefined) => Number(d ?? 0);

export function serializeLeaveType(t: LeaveType) {
  return { ...t, annualQuota: n(t.annualQuota), accrualPerMonth: n(t.accrualPerMonth), carryForwardMax: n(t.carryForwardMax) };
}

type BalanceRow = { id?: string; opening: Prisma.Decimal; accrued: Prisma.Decimal; carriedForward: Prisma.Decimal; adjusted: Prisma.Decimal; used: Prisma.Decimal };
export function availableOf(b: BalanceRow | null | undefined) {
  if (!b) return 0;
  return n(b.opening) + n(b.accrued) + n(b.carriedForward) + n(b.adjusted) - n(b.used);
}

type LeaveRow = Prisma.LeaveRequestGetPayload<{ include: { employee: typeof employeeLite; leaveType: typeof typeLite } }> & { approver?: { displayName: string } | null };
export function serializeLeave(r: LeaveRow) {
  return {
    ...r,
    days: n(r.days),
    startDate: isoDate(r.startDate),
    endDate: isoDate(r.endDate),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    employee: { id: r.employee.id, displayName: r.employee.displayName, employeeCode: r.employee.employeeCode, photoUrl: r.employee.photoUrl, department: r.employee.department },
  };
}
export type LeaveRequestDto = ReturnType<typeof serializeLeave>;

async function assertNotOwn(actor: Actor, employeeId: string) {
  const scope = await authorize(actor, "leave:approve", { employeeId });
  if (scope !== "ALL" && actor.employeeId === employeeId) throw new ForbiddenError("You cannot decide your own leave request");
}

// ── Leave types ──────────────────────────────────────────────────────────

export async function listLeaveTypes(actor: Actor, opts: { includeInactive?: boolean } = {}) {
  await authorize(actor, "leave:read");
  const types = await db.leaveType.findMany({ where: opts.includeInactive ? {} : { isActive: true }, orderBy: { code: "asc" } });
  return types.map(serializeLeaveType);
}

export async function createLeaveType(actor: Actor, input: z.infer<typeof leaveTypeSchema>) {
  await authorize(actor, "leave:manage");
  const t = await db.leaveType.create({ data: input });
  await audit(actor, "leave.type.create", "LeaveType", t.id, { after: t });
  return serializeLeaveType(t);
}

export async function updateLeaveType(actor: Actor, id: string, patch: z.infer<typeof leaveTypePatchSchema>) {
  await authorize(actor, "leave:manage");
  const before = await db.leaveType.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Leave type");
  const t = await db.leaveType.update({ where: { id }, data: patch });
  await audit(actor, "leave.type.update", "LeaveType", id, { before, after: t });
  return serializeLeaveType(t);
}

export async function deleteLeaveType(actor: Actor, id: string) {
  await authorize(actor, "leave:manage");
  const before = await db.leaveType.findUnique({ where: { id }, include: { _count: { select: { requests: true, balances: true } } } });
  if (!before) throw new NotFoundError("Leave type");
  if (before._count.requests > 0 || before._count.balances > 0) {
    await db.leaveType.update({ where: { id }, data: { isActive: false } });
    await audit(actor, "leave.type.deactivate", "LeaveType", id, { before });
    return { deleted: false, deactivated: true };
  }
  await db.leaveType.delete({ where: { id } });
  await audit(actor, "leave.type.delete", "LeaveType", id, { before });
  return { deleted: true, deactivated: false };
}

// ── Balances ─────────────────────────────────────────────────────────────

export async function getBalances(actor: Actor, employeeId: string | null | undefined, year?: number) {
  const target = employeeId ?? requireEmployee(actor);
  await authorize(actor, "leave:read", { employeeId: target });
  const y = year ?? todayIst().getUTCFullYear();
  const rows = await db.leaveBalance.findMany({ where: { employeeId: target, year: y }, include: { leaveType: true }, orderBy: { leaveType: { code: "asc" } } });
  return rows.map((b) => ({
    id: b.id,
    employeeId: b.employeeId,
    year: b.year,
    leaveTypeId: b.leaveTypeId,
    leaveType: serializeLeaveType(b.leaveType),
    opening: n(b.opening),
    accrued: n(b.accrued),
    carriedForward: n(b.carriedForward),
    adjusted: n(b.adjusted),
    used: n(b.used),
    available: availableOf(b),
  }));
}
export type LeaveBalanceDto = Awaited<ReturnType<typeof getBalances>>[number];

export async function adjustBalance(actor: Actor, input: z.infer<typeof adjustBalanceSchema>) {
  await authorize(actor, "leave:manage", { employeeId: input.employeeId });
  const type = await db.leaveType.findUnique({ where: { id: input.leaveTypeId }, select: { id: true } });
  if (!type) throw new NotFoundError("Leave type");
  const before = await db.leaveBalance.findUnique({ where: { employeeId_leaveTypeId_year: { employeeId: input.employeeId, leaveTypeId: input.leaveTypeId, year: input.year } } });
  const after = await db.leaveBalance.upsert({
    where: { employeeId_leaveTypeId_year: { employeeId: input.employeeId, leaveTypeId: input.leaveTypeId, year: input.year } },
    create: { employeeId: input.employeeId, leaveTypeId: input.leaveTypeId, year: input.year, adjusted: input.delta },
    update: { adjusted: { increment: input.delta } },
  });
  await audit(actor, "leave.balance.adjust", "LeaveBalance", after.id, { before, after: { ...after, reason: input.reason, delta: input.delta } });
  await notify({ employeeId: input.employeeId, type: "leave.balance.adjusted", title: `Leave balance adjusted by ${input.delta > 0 ? "+" : ""}${input.delta} day(s)`, body: input.reason, link: "/leave" });
  return { ...after, opening: n(after.opening), accrued: n(after.accrued), carriedForward: n(after.carriedForward), adjusted: n(after.adjusted), used: n(after.used), available: availableOf(after) };
}

// ── Apply / preview ──────────────────────────────────────────────────────

interface Computed {
  days: number;
  workingDays: number;
  available: number | null;
  warnings: string[];
  errors: string[];
  type: LeaveType;
}

async function computeLeave(employeeId: string, input: z.infer<typeof leavePreviewSchema>, opts: { attachmentKey?: string; excludeRequestId?: string } = {}): Promise<Computed> {
  const [type, emp] = await Promise.all([
    db.leaveType.findUnique({ where: { id: input.leaveTypeId } }),
    db.employee.findUnique({ where: { id: employeeId }, select: { gender: true, joiningDate: true } }),
  ]);
  if (!type) throw new NotFoundError("Leave type");
  if (!emp) throw new NotFoundError("Employee");
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!type.isActive) errors.push("This leave type is no longer active");
  if (type.applicableGender && type.applicableGender !== emp.gender) errors.push(`${type.name} is not applicable to you`);
  if (input.endDate.getTime() < input.startDate.getTime()) errors.push("End date must be on or after start date");
  if ((input.startHalf || input.endHalf) && !type.allowHalfDay) errors.push(`${type.name} cannot be taken as a half day`);

  const ctx = await getEmployeeCalendarContext(employeeId, input.startDate, input.endDate);
  const workingDays = countLeaveDays(input.startDate, input.endDate, ctx);
  const days = countLeaveDays(input.startDate, input.endDate, ctx, { startHalf: Boolean(input.startHalf), endHalf: Boolean(input.endHalf) });
  if (days <= 0) errors.push("The selected range has no working days");
  if (type.maxConsecutiveDays && days > type.maxConsecutiveDays) errors.push(`${type.name} cannot exceed ${type.maxConsecutiveDays} consecutive days`);
  const notice = Math.round((input.startDate.getTime() - todayIst().getTime()) / 86_400_000);
  if (type.minNoticeDays > 0 && notice < type.minNoticeDays) errors.push(`${type.name} requires at least ${type.minNoticeDays} days notice`);
  if (type.requiresDocAfterDays && days > type.requiresDocAfterDays && !opts.attachmentKey) errors.push(`Attach a supporting document for ${type.name} longer than ${type.requiresDocAfterDays} days`);

  const overlap = await db.leaveRequest.findFirst({
    where: { employeeId, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: input.endDate }, endDate: { gte: input.startDate }, ...(opts.excludeRequestId ? { id: { not: opts.excludeRequestId } } : {}) },
    select: { id: true, startDate: true, endDate: true, status: true },
  });
  if (overlap) errors.push(`Overlaps a ${overlap.status.toLowerCase()} leave (${isoDate(overlap.startDate)} → ${isoDate(overlap.endDate)})`);

  const bal = await db.leaveBalance.findUnique({ where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: type.id, year: input.startDate.getUTCFullYear() } } });
  const available = type.allowNegative && n(type.annualQuota) === 0 ? null : availableOf(bal);
  if (available !== null && days > available) {
    if (type.allowNegative) warnings.push(`Balance is ${available}; ${days - available} day(s) will go negative`);
    else errors.push(`Insufficient balance: ${available} day(s) available, ${days} requested`);
  }
  if (!type.isPaid) warnings.push("This is unpaid leave and will be deducted from salary");
  return { days, workingDays, available, warnings, errors, type };
}

export async function previewLeave(actor: Actor, input: z.infer<typeof leavePreviewSchema>) {
  const employeeId = input.employeeId ?? requireEmployee(actor);
  await authorize(actor, "leave:read", { employeeId });
  const c = await computeLeave(employeeId, input);
  return { days: c.days, workingDays: c.workingDays, available: c.available, warnings: c.warnings, errors: c.errors, leaveType: serializeLeaveType(c.type) };
}

export async function applyLeave(actor: Actor, input: z.infer<typeof applyLeaveSchema>) {
  const employeeId = input.employeeId ?? requireEmployee(actor);
  await authorize(actor, "leave:apply", { employeeId });
  const c = await computeLeave(employeeId, input, { attachmentKey: input.attachmentKey });
  if (c.errors.length) throw new ValidationError(c.errors[0], c.errors);
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { managerId: true, displayName: true } });
  const req = await db.leaveRequest.create({
    data: {
      employeeId,
      leaveTypeId: input.leaveTypeId,
      startDate: input.startDate,
      endDate: input.endDate,
      startHalf: input.startHalf ?? null,
      endHalf: input.endHalf ?? null,
      days: c.days,
      reason: input.reason,
      attachmentKey: input.attachmentKey ?? null,
      approverId: emp?.managerId ?? null,
    },
    include: { employee: employeeLite, leaveType: typeLite },
  });
  await audit(actor, "leave.apply", "LeaveRequest", req.id, { after: req });
  if (emp?.managerId) {
    await notify({
      employeeId: emp.managerId,
      type: "leave.requested",
      title: `${emp.displayName} applied for ${c.type.name}`,
      body: `${isoDate(input.startDate)} → ${isoDate(input.endDate)} (${c.days} day${c.days === 1 ? "" : "s"}) · ${input.reason}`,
      link: "/approvals",
      email: true,
    });
  }
  return serializeLeave(req);
}

// ── Read ─────────────────────────────────────────────────────────────────

export async function getLeaveRequest(actor: Actor, id: string) {
  const req = await db.leaveRequest.findUnique({ where: { id }, include: { employee: employeeLite, leaveType: typeLite, approver: { select: { displayName: true } } } });
  if (!req) throw new NotFoundError("Leave request");
  await authorize(actor, "leave:read", { employeeId: req.employeeId });
  return serializeLeave(req);
}

export async function listLeaveRequests(actor: Actor, params: z.infer<typeof leaveListSchema>) {
  const scope = await scopeFilter(actor, "leave:read");
  const where: Prisma.LeaveRequestWhereInput = {
    ...scope,
    ...(params.employeeId ? { employeeId: params.employeeId } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.leaveTypeId ? { leaveTypeId: params.leaveTypeId } : {}),
    ...(params.from ? { endDate: { gte: params.from } } : {}),
    ...(params.to ? { startDate: { lte: params.to } } : {}),
    ...(params.departmentId ? { employee: { departmentId: params.departmentId } } : {}),
    ...(params.q ? { employee: { ...(params.departmentId ? { departmentId: params.departmentId } : {}), OR: [{ displayName: { contains: params.q, mode: "insensitive" } }, { employeeCode: { contains: params.q, mode: "insensitive" } }] } } : {}),
  };
  const [items, total] = await Promise.all([
    db.leaveRequest.findMany({ where, orderBy: { createdAt: params.order === "asc" ? "asc" : "desc" }, ...paginate(params), include: { employee: employeeLite, leaveType: typeLite, approver: { select: { displayName: true } } } }),
    db.leaveRequest.count({ where }),
  ]);
  return toPage(items.map(serializeLeave), total, params);
}

// ── Decide / cancel ──────────────────────────────────────────────────────

export async function decideLeave(actor: Actor, id: string, decision: "APPROVED" | "REJECTED", note?: string) {
  const req = await db.leaveRequest.findUnique({ where: { id }, include: { employee: employeeLite, leaveType: typeLite } });
  if (!req) throw new NotFoundError("Leave request");
  await assertNotOwn(actor, req.employeeId);
  if (req.status !== "PENDING") throw new ConflictError(`Request is already ${req.status.toLowerCase()}`);
  const ctx = decision === "APPROVED" ? await getEmployeeCalendarContext(req.employeeId, req.startDate, req.endDate) : null;
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.leaveRequest.update({
      where: { id },
      data: { status: decision, decidedAt: new Date(), decisionNote: note ?? null, approverId: actor.employeeId ?? req.approverId },
      include: { employee: employeeLite, leaveType: typeLite, approver: { select: { displayName: true } } },
    });
    if (decision === "APPROVED" && ctx) {
      const year = req.startDate.getUTCFullYear();
      await tx.leaveBalance.upsert({
        where: { employeeId_leaveTypeId_year: { employeeId: req.employeeId, leaveTypeId: req.leaveTypeId, year } },
        create: { employeeId: req.employeeId, leaveTypeId: req.leaveTypeId, year, used: req.days },
        update: { used: { increment: req.days } },
      });
      for (const d of eachDay(req.startDate, req.endDate)) {
        if (!isWorkingDay(d, ctx)) continue;
        const isHalf = (d.getTime() === req.startDate.getTime() && req.startHalf) || (d.getTime() === req.endDate.getTime() && req.endHalf);
        const existing = await tx.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: req.employeeId, date: d } }, select: { id: true, firstIn: true } });
        // A half-day leave on a day the employee also punched keeps the punch-based record.
        if (isHalf && existing?.firstIn) continue;
        await tx.attendanceRecord.upsert({
          where: { employeeId_date: { employeeId: req.employeeId, date: d } },
          create: { employeeId: req.employeeId, date: d, status: "ON_LEAVE", source: "SYSTEM", remarks: `${req.leaveType.code}${isHalf ? " (half day)" : ""}` },
          update: { status: "ON_LEAVE", source: "SYSTEM", remarks: `${req.leaveType.code}${isHalf ? " (half day)" : ""}` },
        });
      }
    }
    return u;
  });
  await audit(actor, `leave.${decision.toLowerCase()}`, "LeaveRequest", id, { before: req, after: updated });
  await notify({
    employeeId: req.employeeId,
    type: "leave.decided",
    title: `${req.leaveType.name} ${decision.toLowerCase()}: ${isoDate(req.startDate)} → ${isoDate(req.endDate)}`,
    body: note,
    link: "/leave",
    email: true,
  });
  return serializeLeave(updated);
}

export async function cancelLeave(actor: Actor, id: string) {
  const req = await db.leaveRequest.findUnique({ where: { id }, include: { employee: employeeLite, leaveType: typeLite } });
  if (!req) throw new NotFoundError("Leave request");
  const isOwn = actor.employeeId === req.employeeId;
  if (!isOwn) await authorize(actor, "leave:manage", { employeeId: req.employeeId });
  else await authorize(actor, "leave:apply", { employeeId: req.employeeId });
  const today = todayIst();
  if (req.status === "PENDING") {
    // fine
  } else if (req.status === "APPROVED") {
    if (req.startDate.getTime() <= today.getTime()) throw new ValidationError("Approved leave that has already started cannot be cancelled; ask HR to adjust it");
  } else {
    throw new ConflictError(`Request is already ${req.status.toLowerCase()}`);
  }
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.leaveRequest.update({ where: { id }, data: { status: "CANCELLED", decidedAt: new Date() }, include: { employee: employeeLite, leaveType: typeLite, approver: { select: { displayName: true } } } });
    if (req.status === "APPROVED") {
      await tx.leaveBalance.updateMany({ where: { employeeId: req.employeeId, leaveTypeId: req.leaveTypeId, year: req.startDate.getUTCFullYear() }, data: { used: { decrement: req.days } } });
      await tx.attendanceRecord.deleteMany({ where: { employeeId: req.employeeId, date: { gte: req.startDate, lte: req.endDate }, status: "ON_LEAVE", source: "SYSTEM" } });
    }
    return u;
  });
  await audit(actor, "leave.cancel", "LeaveRequest", id, { before: req, after: updated });
  if (req.approverId && req.status === "APPROVED") {
    await notify({ employeeId: req.approverId, type: "leave.cancelled", title: `${req.employee.displayName} cancelled approved ${req.leaveType.name}`, body: `${isoDate(req.startDate)} → ${isoDate(req.endDate)}`, link: "/team" });
  }
  return serializeLeave(updated);
}

// ── Calendar & holidays ──────────────────────────────────────────────────

export async function teamLeaveCalendar(actor: Actor, params: z.infer<typeof calendarQuerySchema>) {
  await authorize(actor, "leave:read", { minScope: "TEAM" });
  const ids = await visibleEmployeeIds(actor, "leave:read");
  if ((params.to.getTime() - params.from.getTime()) / 86_400_000 > 62) throw new ValidationError("Range is limited to 62 days");
  const items = await db.leaveRequest.findMany({
    where: {
      status: { in: ["APPROVED", "PENDING"] },
      startDate: { lte: params.to },
      endDate: { gte: params.from },
      ...(ids ? { employeeId: { in: ids } } : {}),
      ...(params.departmentId ? { employee: { departmentId: params.departmentId } } : {}),
    },
    orderBy: [{ startDate: "asc" }],
    take: 2000,
    include: { employee: employeeLite, leaveType: typeLite },
  });
  return items.map(serializeLeave);
}

export async function myUpcomingHolidays(actor: Actor, limit = 8) {
  const employeeId = actor.employeeId;
  const emp = employeeId ? await db.employee.findUnique({ where: { id: employeeId }, select: { locationId: true } }) : null;
  return upcomingHolidays(emp?.locationId ?? null, todayIst(), limit);
}

// ── Jobs (no actor) ──────────────────────────────────────────────────────

/**
 * Monthly accrual (idempotent). For every accruing leave type and active
 * employee, set `accrued = min(annualQuota, accrualPerMonth × months elapsed
 * in `year` up to and including `month`, counted from the joining month)`.
 * Setting (not adding) makes re-runs safe without a per-month accrual log.
 */
export async function runMonthlyLeaveAccrual(year: number, month: number): Promise<{ year: number; month: number; types: { code: string; rows: number }[] }> {
  if (month < 1 || month > 12) throw new ValidationError("month must be 1-12");
  const types = await db.leaveType.findMany({ where: { isActive: true, accrualPerMonth: { gt: 0 } } });
  const out: { code: string; rows: number }[] = [];
  for (const t of types) {
    const rate = n(t.accrualPerMonth);
    const quota = n(t.annualQuota);
    const genderClause = t.applicableGender ? Prisma.sql`AND e.gender = ${t.applicableGender}::"Gender"` : Prisma.empty;
    const rows = await db.$executeRaw`
      INSERT INTO "LeaveBalance" (id, "employeeId", "leaveTypeId", year, opening, accrued, "carriedForward", adjusted, used, "updatedAt")
      SELECT gen_random_uuid(), e.id, ${t.id}::uuid, ${year}, 0,
        LEAST(${quota}::numeric, ${rate}::numeric * GREATEST(0,
          ${month} - (CASE WHEN EXTRACT(YEAR FROM e."joiningDate") = ${year} THEN EXTRACT(MONTH FROM e."joiningDate")
                           WHEN EXTRACT(YEAR FROM e."joiningDate") > ${year} THEN ${month} + 1
                           ELSE 1 END) + 1)),
        0, 0, 0, now()
      FROM "Employee" e
      WHERE e.status IN ('ACTIVE', 'ON_NOTICE', 'ONBOARDING') ${genderClause}
      ON CONFLICT ("employeeId", "leaveTypeId", year)
      DO UPDATE SET accrued = EXCLUDED.accrued, "updatedAt" = now()`;
    out.push({ code: t.code, rows });
  }
  return { year, month, types: out };
}

/**
 * Year-end carry forward: create `year + 1` balances for every active
 * employee and leave type with carriedForward = min(available, carryForwardMax)
 * and opening = annualQuota for non-accruing types. Re-running only updates
 * carriedForward (never touches used/adjusted of the new year).
 */
export async function runYearEndCarryForward(year: number): Promise<{ from: number; to: number; types: { code: string; rows: number }[] }> {
  const types = await db.leaveType.findMany({ where: { isActive: true } });
  const next = year + 1;
  const out: { code: string; rows: number }[] = [];
  for (const t of types) {
    const cf = n(t.carryForwardMax);
    const opening = n(t.accrualPerMonth) > 0 ? 0 : n(t.annualQuota);
    const genderClause = t.applicableGender ? Prisma.sql`AND e.gender = ${t.applicableGender}::"Gender"` : Prisma.empty;
    const rows = await db.$executeRaw`
      INSERT INTO "LeaveBalance" (id, "employeeId", "leaveTypeId", year, opening, accrued, "carriedForward", adjusted, used, "updatedAt")
      SELECT gen_random_uuid(), e.id, ${t.id}::uuid, ${next}, ${opening}::numeric, 0,
        LEAST(${cf}::numeric, GREATEST(0, COALESCE(b.opening + b.accrued + b."carriedForward" + b.adjusted - b.used, 0))),
        0, 0, now()
      FROM "Employee" e
      LEFT JOIN "LeaveBalance" b ON b."employeeId" = e.id AND b."leaveTypeId" = ${t.id}::uuid AND b.year = ${year}
      WHERE e.status IN ('ACTIVE', 'ON_NOTICE', 'ONBOARDING') ${genderClause}
      ON CONFLICT ("employeeId", "leaveTypeId", year)
      DO UPDATE SET "carriedForward" = EXCLUDED."carriedForward", "updatedAt" = now()`;
    out.push({ code: t.code, rows });
  }
  return { from: year, to: next, types: out };
}

/** Actor-facing wrappers for the admin screen. */
export async function triggerYearEndCarryForward(actor: Actor, year: number) {
  await authorize(actor, "leave:manage", { minScope: "ALL" });
  const r = await runYearEndCarryForward(year);
  await audit(actor, "leave.carry_forward.run", "LeaveBalance", null, { after: r });
  return r;
}

export async function triggerMonthlyAccrual(actor: Actor, year: number, month: number) {
  await authorize(actor, "leave:manage", { minScope: "ALL" });
  const r = await runMonthlyLeaveAccrual(year, month);
  await audit(actor, "leave.accrual.run", "LeaveBalance", null, { after: r });
  return r;
}
