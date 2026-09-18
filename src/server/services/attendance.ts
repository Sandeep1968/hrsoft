import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { Prisma, type AttendanceStatus, type RequestStatus } from "@/generated/prisma/client";
import { paginate, paginationSchema, toPage, zDateOnly, zUuid } from "@/lib/api";
import { audit } from "@/lib/audit";
import { addDays, atTime, eachDay, isoDate, monthRange, toDateOnly } from "@/lib/dates";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { notify } from "@/lib/notify";
import { authorize, requireEmployee, scopeFilter, scopeOf, visibleEmployeeIds, type Actor } from "@/lib/rbac/authorize";
import {
  countWorkingDays,
  dayKind,
  getCalendarContextsFor,
  getDefaultShift,
  getEmployeeCalendarContext,
  getEmployeeShift,
  holidayOn,
  IST_OFFSET_MINUTES,
  isWorkingDay,
  todayIst,
  type CalendarContext,
  type ShiftLite,
} from "@/server/services/calendar";

// ── Schemas ──────────────────────────────────────────────────────────────

export const punchSchema = z.object({
  type: z.enum(["IN", "OUT"]),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  ip: z.string().max(64).optional(),
});

export const monthQuerySchema = z.object({
  employeeId: zUuid.optional(),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export const teamAttendanceQuerySchema = paginationSchema.extend({
  date: zDateOnly.optional(),
  departmentId: zUuid.optional(),
  status: z.enum(["PRESENT", "ABSENT", "HALF_DAY", "ON_LEAVE", "HOLIDAY", "WEEK_OFF", "WFH", "NO_RECORD"]).optional(),
});

export const adminRecordSchema = z.object({
  employeeId: zUuid,
  date: zDateOnly,
  status: z.enum(["PRESENT", "ABSENT", "HALF_DAY", "ON_LEAVE", "HOLIDAY", "WEEK_OFF", "WFH"]).optional(),
  firstIn: z.coerce.date().nullable().optional(),
  lastOut: z.coerce.date().nullable().optional(),
  workMinutes: z.number().int().min(0).max(1440).optional(),
  lateMinutes: z.number().int().min(0).max(1440).optional(),
  remarks: z.string().max(500).nullable().optional(),
  isRegularized: z.boolean().optional(),
});

export const regularizationSchema = z.object({
  date: zDateOnly,
  requestedIn: z.coerce.date(),
  requestedOut: z.coerce.date(),
  reason: z.string().trim().min(3).max(500),
});

export const remoteWorkSchema = z.object({
  fromDate: zDateOnly,
  toDate: zDateOnly,
  reason: z.string().trim().min(3).max(500),
});

export const requestListSchema = paginationSchema.extend({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  employeeId: zUuid.optional(),
  departmentId: zUuid.optional(),
  from: zDateOnly.optional(),
  to: zDateOnly.optional(),
});

export const decideSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().max(500).optional(),
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");
export const shiftSchema = z.object({
  name: z.string().trim().min(1).max(80),
  startTime: hhmm.default("09:00"),
  endTime: hhmm.default("18:00"),
  breakMinutes: z.number().int().min(0).max(240).default(60),
  graceMinutes: z.number().int().min(0).max(120).default(15),
  fullDayMinutes: z.number().int().min(60).max(1440).default(480),
  halfDayMinutes: z.number().int().min(30).max(1440).default(240),
  weeklyOffDays: z.array(z.number().int().min(0).max(6)).max(7).default([0, 6]),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export const shiftPatchSchema = shiftSchema.partial();

export const assignShiftSchema = z
  .object({
    shiftId: zUuid,
    employeeIds: z.array(zUuid).max(5000).optional(),
    employeeCodes: z.array(z.string().trim().min(1).max(40)).max(5000).optional(),
    departmentId: zUuid.optional(),
  })
  .refine((v) => (v.employeeIds?.length ?? 0) > 0 || (v.employeeCodes?.length ?? 0) > 0 || v.departmentId, { message: "Provide employeeIds, employeeCodes or departmentId" });

export const holidayCalendarSchema = z.object({
  name: z.string().trim().min(1).max(80),
  year: z.number().int().min(2000).max(2100),
  locationId: zUuid.nullable().optional(),
});
export const holidayCalendarPatchSchema = holidayCalendarSchema.partial();

export const holidaysBulkSchema = z.object({
  holidays: z.array(z.object({ date: zDateOnly, name: z.string().trim().min(1).max(120), isOptional: z.boolean().default(false) })).min(1).max(100),
});

export const cloneCalendarSchema = z.object({ targetYear: z.number().int().min(2000).max(2100) });

// ── Helpers ──────────────────────────────────────────────────────────────

const employeeLite = { select: { id: true, displayName: true, employeeCode: true, photoUrl: true, department: { select: { id: true, name: true } } } } as const;

function minutesBetween(a: Date, b: Date) {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));
}

function statusFor(workMinutes: number, shift: ShiftLite, opts: { open?: boolean } = {}): AttendanceStatus {
  if (workMinutes >= shift.fullDayMinutes) return "PRESENT";
  if (workMinutes >= shift.halfDayMinutes) return "HALF_DAY";
  return opts.open ? "PRESENT" : "ABSENT";
}

function lateFor(date: Date, firstIn: Date | null, shift: ShiftLite): number {
  if (!firstIn) return 0;
  const cutoff = atTime(date, shift.startTime, IST_OFFSET_MINUTES).getTime() + shift.graceMinutes * 60_000;
  return Math.max(0, Math.round((firstIn.getTime() - cutoff) / 60_000));
}

/** Recompute firstIn / lastOut / workMinutes / lateMinutes / status from the punch trail. */
function summarizePunches(date: Date, punches: { time: Date; type: "IN" | "OUT" }[], shift: ShiftLite) {
  const sorted = [...punches].sort((a, b) => a.time.getTime() - b.time.getTime());
  let firstIn: Date | null = null;
  let lastOut: Date | null = null;
  let workMinutes = 0;
  let openIn: Date | null = null;
  for (const p of sorted) {
    if (p.type === "IN") {
      if (!firstIn) firstIn = p.time;
      if (!openIn) openIn = p.time;
    } else {
      lastOut = p.time;
      if (openIn) {
        workMinutes += minutesBetween(openIn, p.time);
        openIn = null;
      }
    }
  }
  const open = openIn !== null;
  return { firstIn, lastOut, workMinutes, lateMinutes: lateFor(date, firstIn, shift), status: statusFor(workMinutes, shift, { open }) };
}

async function assertNotOwn(actor: Actor, permission: "attendance:approve", employeeId: string) {
  const scope = await authorize(actor, permission, { employeeId });
  if (scope !== "ALL" && actor.employeeId === employeeId) throw new ForbiddenError("You cannot decide your own request");
}

function serializeRecord<T extends { firstIn: Date | null; lastOut: Date | null; date: Date; updatedAt?: Date }>(r: T) {
  return { ...r, date: isoDate(r.date), firstIn: r.firstIn?.toISOString() ?? null, lastOut: r.lastOut?.toISOString() ?? null, updatedAt: r.updatedAt?.toISOString() };
}

// ── Punching ─────────────────────────────────────────────────────────────

export async function punch(actor: Actor, input: z.infer<typeof punchSchema>) {
  const employeeId = requireEmployee(actor);
  await authorize(actor, "attendance:punch", { employeeId });
  const date = todayIst();
  const shift = await getEmployeeShift(employeeId);
  const now = new Date();

  const result = await db.$transaction(async (tx) => {
    const record = await tx.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId, date } },
      create: { employeeId, date, status: "PRESENT", source: "WEB" },
      update: {},
      select: { id: true, punches: { select: { time: true, type: true }, orderBy: { time: "asc" } } },
    });
    const last = record.punches.at(-1);
    if (input.type === "IN" && last?.type === "IN") throw new ConflictError("You are already clocked in");
    if (input.type === "OUT" && (!last || last.type === "OUT")) throw new ConflictError("You are not clocked in");

    await tx.attendancePunch.create({
      data: { recordId: record.id, time: now, type: input.type, source: "WEB", latitude: input.latitude, longitude: input.longitude, ip: input.ip ?? actor.ip ?? null },
    });
    const punches = [...record.punches, { time: now, type: input.type }];
    const summary = summarizePunches(date, punches, shift);
    return tx.attendanceRecord.update({
      where: { id: record.id },
      data: { ...summary, source: "WEB" },
      include: { punches: { orderBy: { time: "asc" } } },
    });
  });
  return serializeToday(result, shift);
}

type TodayRecord = Prisma.AttendanceRecordGetPayload<{ include: { punches: true } }>;

function serializeToday(record: TodayRecord | null, shift: ShiftLite) {
  const punches = record?.punches ?? [];
  const last = punches.at(-1);
  return {
    date: isoDate(record?.date ?? todayIst()),
    record: record ? serializeRecord({ ...record, punches: undefined }) : null,
    punches: punches.map((p) => ({ id: p.id, time: p.time.toISOString(), type: p.type, source: p.source })),
    clockedIn: last?.type === "IN",
    shift: { name: shift.name, startTime: shift.startTime, endTime: shift.endTime, fullDayMinutes: shift.fullDayMinutes, halfDayMinutes: shift.halfDayMinutes, graceMinutes: shift.graceMinutes },
    serverTime: new Date().toISOString(),
  };
}

export async function getToday(actor: Actor) {
  const employeeId = requireEmployee(actor);
  await authorize(actor, "attendance:read", { employeeId });
  const date = todayIst();
  const [record, shift] = await Promise.all([
    db.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId, date } }, include: { punches: { orderBy: { time: "asc" } } } }),
    getEmployeeShift(employeeId),
  ]);
  return serializeToday(record, shift);
}

// ── Month view ───────────────────────────────────────────────────────────

export interface MonthDay {
  date: string;
  dow: number;
  status: AttendanceStatus | null;
  isWorkingDay: boolean;
  holiday: { name: string; isOptional: boolean } | null;
  leave: { code: string; name: string; color: string; status: RequestStatus; half: boolean } | null;
  firstIn: string | null;
  lastOut: string | null;
  workMinutes: number;
  lateMinutes: number;
  isRegularized: boolean;
  remarks: string | null;
  recordId: string | null;
  isFuture: boolean;
}

export async function getMonth(actor: Actor, employeeId: string | null | undefined, year: number, month: number) {
  const target = employeeId ?? requireEmployee(actor);
  await authorize(actor, "attendance:read", { employeeId: target });
  const { start, end } = monthRange(year, month);
  const [ctx, records, leaves, employee] = await Promise.all([
    getEmployeeCalendarContext(target, start, end),
    db.attendanceRecord.findMany({ where: { employeeId: target, date: { gte: start, lte: end } }, orderBy: { date: "asc" } }),
    db.leaveRequest.findMany({
      where: { employeeId: target, status: { in: ["APPROVED", "PENDING"] }, startDate: { lte: end }, endDate: { gte: start } },
      select: { startDate: true, endDate: true, startHalf: true, endHalf: true, status: true, leaveType: { select: { code: true, name: true, color: true } } },
    }),
    db.employee.findUnique({ where: { id: target }, select: { id: true, displayName: true, employeeCode: true, photoUrl: true, joiningDate: true } }),
  ]);
  if (!employee) throw new NotFoundError("Employee");
  const byDate = new Map(records.map((r) => [isoDate(r.date), r]));
  const today = todayIst();
  const days: MonthDay[] = [];
  for (const d of eachDay(start, end)) {
    const key = isoDate(d);
    const rec = byDate.get(key);
    const holiday = holidayOn(d, ctx) ?? null;
    const working = isWorkingDay(d, ctx);
    const leave = leaves.find((l) => l.startDate.getTime() <= d.getTime() && l.endDate.getTime() >= d.getTime());
    const half = Boolean(leave && ((leave.startDate.getTime() === d.getTime() && leave.startHalf) || (leave.endDate.getTime() === d.getTime() && leave.endHalf)));
    const isFuture = d.getTime() > today.getTime();
    let status: AttendanceStatus | null = rec?.status ?? null;
    if (!status) {
      const kind = dayKind(d, ctx);
      if (kind) status = kind;
      else if (leave?.status === "APPROVED") status = "ON_LEAVE";
      else if (!isFuture && d.getTime() >= employee.joiningDate.getTime()) status = "ABSENT";
    }
    days.push({
      date: key,
      dow: d.getUTCDay(),
      status,
      isWorkingDay: working,
      holiday,
      leave: leave ? { code: leave.leaveType.code, name: leave.leaveType.name, color: leave.leaveType.color, status: leave.status, half } : null,
      firstIn: rec?.firstIn?.toISOString() ?? null,
      lastOut: rec?.lastOut?.toISOString() ?? null,
      workMinutes: rec?.workMinutes ?? 0,
      lateMinutes: rec?.lateMinutes ?? 0,
      isRegularized: rec?.isRegularized ?? false,
      remarks: rec?.remarks ?? null,
      recordId: rec?.id ?? null,
      isFuture,
    });
  }
  const summary = summarizeDays(days);
  return { employee: { ...employee, joiningDate: isoDate(employee.joiningDate) }, year, month, days, summary, workingDays: countWorkingDays(start, end, ctx) };
}

function summarizeDays(days: MonthDay[]) {
  const s: Record<AttendanceStatus, number> = { PRESENT: 0, ABSENT: 0, HALF_DAY: 0, ON_LEAVE: 0, HOLIDAY: 0, WEEK_OFF: 0, WFH: 0 };
  let late = 0;
  let minutes = 0;
  for (const d of days) {
    if (d.status) s[d.status]++;
    if (d.lateMinutes > 0) late++;
    minutes += d.workMinutes;
  }
  return { ...s, lateDays: late, workMinutes: minutes };
}

// ── Team view ────────────────────────────────────────────────────────────

export async function listTeamAttendance(actor: Actor, params: z.infer<typeof teamAttendanceQuerySchema>) {
  await authorize(actor, "attendance:read", { minScope: "TEAM" });
  const ids = await visibleEmployeeIds(actor, "attendance:read");
  const date = params.date ?? todayIst();
  const where: Prisma.EmployeeWhereInput = {
    status: { in: ["ACTIVE", "ON_NOTICE", "ONBOARDING"] },
    ...(ids ? { id: { in: ids } } : {}),
    ...(params.departmentId ? { departmentId: params.departmentId } : {}),
    ...(params.q ? { OR: [{ displayName: { contains: params.q, mode: "insensitive" } }, { employeeCode: { contains: params.q, mode: "insensitive" } }] } : {}),
    ...(params.status === "NO_RECORD" ? { attendance: { none: { date } } } : params.status ? { attendance: { some: { date, status: params.status } } } : {}),
  };
  const [items, total, grouped, headcount] = await Promise.all([
    db.employee.findMany({
      where,
      orderBy: { displayName: "asc" },
      ...paginate(params),
      select: {
        id: true,
        displayName: true,
        employeeCode: true,
        photoUrl: true,
        department: { select: { id: true, name: true } },
        shift: { select: { name: true } },
        attendance: { where: { date }, take: 1, select: { status: true, firstIn: true, lastOut: true, workMinutes: true, lateMinutes: true, isRegularized: true } },
      },
    }),
    db.employee.count({ where }),
    db.attendanceRecord.groupBy({
      by: ["status"],
      where: { date, ...(ids ? { employeeId: { in: ids } } : {}), ...(params.departmentId ? { employee: { departmentId: params.departmentId } } : {}), employee: { status: { in: ["ACTIVE", "ON_NOTICE", "ONBOARDING"] }, ...(params.departmentId ? { departmentId: params.departmentId } : {}) } },
      _count: { _all: true },
    }),
    db.employee.count({ where: { status: { in: ["ACTIVE", "ON_NOTICE", "ONBOARDING"] }, ...(ids ? { id: { in: ids } } : {}), ...(params.departmentId ? { departmentId: params.departmentId } : {}) } }),
  ]);
  const summary: Record<string, number> = { PRESENT: 0, ABSENT: 0, HALF_DAY: 0, ON_LEAVE: 0, HOLIDAY: 0, WEEK_OFF: 0, WFH: 0 };
  let recorded = 0;
  for (const g of grouped) {
    summary[g.status] = g._count._all;
    recorded += g._count._all;
  }
  summary.NO_RECORD = Math.max(0, headcount - recorded);
  const page = toPage(
    items.map((e) => {
      const r = e.attendance[0];
      return {
        id: e.id,
        displayName: e.displayName,
        employeeCode: e.employeeCode,
        photoUrl: e.photoUrl,
        department: e.department,
        shift: e.shift?.name ?? null,
        status: r?.status ?? null,
        firstIn: r?.firstIn?.toISOString() ?? null,
        lastOut: r?.lastOut?.toISOString() ?? null,
        workMinutes: r?.workMinutes ?? 0,
        lateMinutes: r?.lateMinutes ?? 0,
        isRegularized: r?.isRegularized ?? false,
      };
    }),
    total,
    params,
  );
  return { ...page, date: isoDate(date), summary, headcount };
}

// ── Admin correction ─────────────────────────────────────────────────────

export async function adminUpsertRecord(actor: Actor, input: z.infer<typeof adminRecordSchema>) {
  const { employeeId, date, ...patch } = input;
  await authorize(actor, "attendance:write", { employeeId });
  const shift = await getEmployeeShift(employeeId);
  const before = await db.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId, date } } });
  const firstIn = patch.firstIn === undefined ? before?.firstIn ?? null : patch.firstIn;
  const lastOut = patch.lastOut === undefined ? before?.lastOut ?? null : patch.lastOut;
  if (firstIn && lastOut && lastOut.getTime() <= firstIn.getTime()) throw new ValidationError("Out time must be after in time");
  let workMinutes = patch.workMinutes ?? before?.workMinutes ?? 0;
  if (patch.workMinutes === undefined && (patch.firstIn !== undefined || patch.lastOut !== undefined) && firstIn && lastOut) {
    workMinutes = Math.max(0, minutesBetween(firstIn, lastOut) - shift.breakMinutes);
  }
  const status = patch.status ?? (patch.firstIn !== undefined || patch.lastOut !== undefined || patch.workMinutes !== undefined ? statusFor(workMinutes, shift) : before?.status ?? "PRESENT");
  const lateMinutes = patch.lateMinutes ?? (firstIn ? lateFor(date, firstIn, shift) : 0);
  const data = { firstIn, lastOut, workMinutes, lateMinutes, status, remarks: patch.remarks === undefined ? before?.remarks ?? null : patch.remarks, isRegularized: patch.isRegularized ?? true, source: "MANUAL" as const };
  const after = await db.attendanceRecord.upsert({ where: { employeeId_date: { employeeId, date } }, create: { employeeId, date, ...data }, update: data });
  await audit(actor, "attendance.correct", "AttendanceRecord", after.id, { before, after });
  return serializeRecord(after);
}

export async function getRecord(actor: Actor, employeeId: string, date: Date) {
  await authorize(actor, "attendance:read", { employeeId });
  const [rec, employee] = await Promise.all([
    db.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId, date } }, include: { punches: { orderBy: { time: "asc" } } } }),
    db.employee.findUnique({ where: { id: employeeId }, ...employeeLite }),
  ]);
  if (!employee) throw new NotFoundError("Employee");
  return { employee, date: isoDate(date), record: rec ? { ...serializeRecord({ ...rec, punches: undefined }), punches: rec.punches.map((p) => ({ ...p, time: p.time.toISOString() })) } : null };
}

// ── Regularisation ───────────────────────────────────────────────────────

export async function requestRegularization(actor: Actor, input: z.infer<typeof regularizationSchema>) {
  const employeeId = requireEmployee(actor);
  await authorize(actor, "attendance:punch", { employeeId });
  const today = todayIst();
  if (input.date.getTime() > today.getTime()) throw new ValidationError("Cannot regularise a future date");
  if (input.date.getTime() < addDays(today, -60).getTime()) throw new ValidationError("Regularisation is limited to the last 60 days");
  if (input.requestedOut.getTime() <= input.requestedIn.getTime()) throw new ValidationError("Out time must be after in time");
  if (isoDate(toDateOnly(new Date(input.requestedIn.getTime() + IST_OFFSET_MINUTES * 60_000))) !== isoDate(input.date)) throw new ValidationError("In time must fall on the requested date");
  const dup = await db.regularizationRequest.findFirst({ where: { employeeId, date: input.date, status: "PENDING" }, select: { id: true } });
  if (dup) throw new ConflictError("A regularisation request for this date is already pending");
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { managerId: true, displayName: true } });
  const req = await db.regularizationRequest.create({ data: { ...input, employeeId, approverId: emp?.managerId ?? null }, include: { employee: employeeLite } });
  await audit(actor, "attendance.regularization.request", "RegularizationRequest", req.id, { after: req });
  if (emp?.managerId) {
    await notify({ employeeId: emp.managerId, type: "regularization.requested", title: `${emp.displayName} requested attendance regularisation`, body: `${isoDate(input.date)} · ${input.reason}`, link: "/approvals", email: true });
  }
  return serializeRegularization(req);
}

type RegRow = Prisma.RegularizationRequestGetPayload<{ include: { employee: typeof employeeLite } }> & { approver?: { displayName: string } | null };
function serializeRegularization(r: RegRow) {
  return { ...r, date: isoDate(r.date), requestedIn: r.requestedIn.toISOString(), requestedOut: r.requestedOut.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() };
}

export async function listRegularizations(actor: Actor, params: z.infer<typeof requestListSchema>) {
  const scope = await scopeFilter(actor, "attendance:read");
  const where: Prisma.RegularizationRequestWhereInput = {
    ...scope,
    ...(params.employeeId ? { employeeId: params.employeeId } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.from || params.to ? { date: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } } : {}),
    ...(params.departmentId ? { employee: { departmentId: params.departmentId } } : {}),
  };
  const [items, total] = await Promise.all([
    db.regularizationRequest.findMany({ where, orderBy: { createdAt: params.order === "asc" ? "asc" : "desc" }, ...paginate(params), include: { employee: employeeLite, approver: { select: { displayName: true } } } }),
    db.regularizationRequest.count({ where }),
  ]);
  return toPage(items.map(serializeRegularization), total, params);
}

export async function decideRegularization(actor: Actor, id: string, decision: "APPROVED" | "REJECTED", note?: string) {
  const req = await db.regularizationRequest.findUnique({ where: { id }, include: { employee: employeeLite } });
  if (!req) throw new NotFoundError("Regularisation request");
  await assertNotOwn(actor, "attendance:approve", req.employeeId);
  if (req.status !== "PENDING") throw new ConflictError(`Request is already ${req.status.toLowerCase()}`);
  const shift = await getEmployeeShift(req.employeeId);
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.regularizationRequest.update({
      where: { id },
      data: { status: decision, decidedAt: new Date(), decisionNote: note ?? null, approverId: actor.employeeId ?? req.approverId },
      include: { employee: employeeLite, approver: { select: { displayName: true } } },
    });
    if (decision === "APPROVED") {
      const workMinutes = Math.max(0, minutesBetween(req.requestedIn, req.requestedOut) - shift.breakMinutes);
      const data = { firstIn: req.requestedIn, lastOut: req.requestedOut, workMinutes, lateMinutes: lateFor(req.date, req.requestedIn, shift), status: statusFor(workMinutes, shift), isRegularized: true, source: "MANUAL" as const };
      await tx.attendanceRecord.upsert({ where: { employeeId_date: { employeeId: req.employeeId, date: req.date } }, create: { employeeId: req.employeeId, date: req.date, ...data }, update: data });
    }
    return u;
  });
  await audit(actor, `attendance.regularization.${decision.toLowerCase()}`, "RegularizationRequest", id, { before: req, after: updated });
  await notify({ employeeId: req.employeeId, type: "regularization.decided", title: `Regularisation for ${isoDate(req.date)} ${decision.toLowerCase()}`, body: note, link: "/attendance", email: true });
  return serializeRegularization(updated);
}

// ── Remote work ──────────────────────────────────────────────────────────

type RemoteRow = Prisma.RemoteWorkRequestGetPayload<{ include: { employee: typeof employeeLite } }> & { approver?: { displayName: string } | null };
function serializeRemote(r: RemoteRow) {
  return { ...r, fromDate: isoDate(r.fromDate), toDate: isoDate(r.toDate), decidedAt: r.decidedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() };
}

export async function requestRemoteWork(actor: Actor, input: z.infer<typeof remoteWorkSchema>) {
  const employeeId = requireEmployee(actor);
  await authorize(actor, "attendance:punch", { employeeId });
  if (input.toDate.getTime() < input.fromDate.getTime()) throw new ValidationError("End date must be on or after start date");
  if ((input.toDate.getTime() - input.fromDate.getTime()) / 86_400_000 > 31) throw new ValidationError("Remote work requests are limited to 31 days");
  const overlap = await db.remoteWorkRequest.findFirst({ where: { employeeId, status: { in: ["PENDING", "APPROVED"] }, fromDate: { lte: input.toDate }, toDate: { gte: input.fromDate } }, select: { id: true } });
  if (overlap) throw new ConflictError("An overlapping remote work request already exists");
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { managerId: true, displayName: true } });
  const req = await db.remoteWorkRequest.create({ data: { ...input, employeeId, approverId: emp?.managerId ?? null }, include: { employee: employeeLite } });
  await audit(actor, "attendance.remote.request", "RemoteWorkRequest", req.id, { after: req });
  if (emp?.managerId) {
    await notify({ employeeId: emp.managerId, type: "remote.requested", title: `${emp.displayName} requested work from home`, body: `${isoDate(input.fromDate)} → ${isoDate(input.toDate)} · ${input.reason}`, link: "/approvals", email: true });
  }
  return serializeRemote(req);
}

export async function listRemoteWork(actor: Actor, params: z.infer<typeof requestListSchema>) {
  const scope = await scopeFilter(actor, "attendance:read");
  const where: Prisma.RemoteWorkRequestWhereInput = {
    ...scope,
    ...(params.employeeId ? { employeeId: params.employeeId } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.from ? { toDate: { gte: params.from } } : {}),
    ...(params.to ? { fromDate: { lte: params.to } } : {}),
    ...(params.departmentId ? { employee: { departmentId: params.departmentId } } : {}),
  };
  const [items, total] = await Promise.all([
    db.remoteWorkRequest.findMany({ where, orderBy: { createdAt: params.order === "asc" ? "asc" : "desc" }, ...paginate(params), include: { employee: employeeLite, approver: { select: { displayName: true } } } }),
    db.remoteWorkRequest.count({ where }),
  ]);
  return toPage(items.map(serializeRemote), total, params);
}

export async function decideRemoteWork(actor: Actor, id: string, decision: "APPROVED" | "REJECTED", note?: string) {
  const req = await db.remoteWorkRequest.findUnique({ where: { id }, include: { employee: employeeLite } });
  if (!req) throw new NotFoundError("Remote work request");
  await assertNotOwn(actor, "attendance:approve", req.employeeId);
  if (req.status !== "PENDING") throw new ConflictError(`Request is already ${req.status.toLowerCase()}`);
  const [shift, ctx] = await Promise.all([getEmployeeShift(req.employeeId), getEmployeeCalendarContext(req.employeeId, req.fromDate, req.toDate)]);
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.remoteWorkRequest.update({
      where: { id },
      data: { status: decision, decidedAt: new Date(), decisionNote: note ?? null, approverId: actor.employeeId ?? req.approverId },
      include: { employee: employeeLite, approver: { select: { displayName: true } } },
    });
    if (decision === "APPROVED") {
      for (const d of eachDay(req.fromDate, req.toDate)) {
        if (!isWorkingDay(d, ctx)) continue;
        await tx.attendanceRecord.upsert({
          where: { employeeId_date: { employeeId: req.employeeId, date: d } },
          create: { employeeId: req.employeeId, date: d, status: "WFH", workMinutes: shift.fullDayMinutes, source: "SYSTEM" },
          update: { status: "WFH", workMinutes: shift.fullDayMinutes, source: "SYSTEM" },
        });
      }
    }
    return u;
  });
  await audit(actor, `attendance.remote.${decision.toLowerCase()}`, "RemoteWorkRequest", id, { before: req, after: updated });
  await notify({ employeeId: req.employeeId, type: "remote.decided", title: `Work from home request ${decision.toLowerCase()}`, body: `${isoDate(req.fromDate)} → ${isoDate(req.toDate)}${note ? ` · ${note}` : ""}`, link: "/attendance", email: true });
  return serializeRemote(updated);
}

// ── Shifts ───────────────────────────────────────────────────────────────

export async function listShifts(actor: Actor, opts: { includeInactive?: boolean } = {}) {
  await authorize(actor, "attendance:read");
  const shifts = await db.shift.findMany({ where: opts.includeInactive ? {} : { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], include: { _count: { select: { employees: true } } } });
  return shifts.map((s) => ({ ...s, employeeCount: s._count.employees, _count: undefined }));
}

export async function createShift(actor: Actor, input: z.infer<typeof shiftSchema>) {
  await authorize(actor, "attendance:manage");
  const shift = await db.$transaction(async (tx) => {
    if (input.isDefault) await tx.shift.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    return tx.shift.create({ data: input });
  });
  await audit(actor, "attendance.shift.create", "Shift", shift.id, { after: shift });
  return shift;
}

export async function updateShift(actor: Actor, id: string, patch: z.infer<typeof shiftPatchSchema>) {
  await authorize(actor, "attendance:manage");
  const before = await db.shift.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Shift");
  const shift = await db.$transaction(async (tx) => {
    if (patch.isDefault) await tx.shift.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
    return tx.shift.update({ where: { id }, data: patch });
  });
  await audit(actor, "attendance.shift.update", "Shift", id, { before, after: shift });
  return shift;
}

export async function deleteShift(actor: Actor, id: string) {
  await authorize(actor, "attendance:manage");
  const shift = await db.shift.findUnique({ where: { id }, include: { _count: { select: { employees: true } } } });
  if (!shift) throw new NotFoundError("Shift");
  if (shift.isDefault) throw new ValidationError("The default shift cannot be deleted");
  if (shift._count.employees > 0) {
    const after = await db.shift.update({ where: { id }, data: { isActive: false } });
    await audit(actor, "attendance.shift.deactivate", "Shift", id, { before: shift, after });
    return { deleted: false, deactivated: true };
  }
  await db.shift.delete({ where: { id } });
  await audit(actor, "attendance.shift.delete", "Shift", id, { before: shift });
  return { deleted: true, deactivated: false };
}

export async function assignShift(actor: Actor, input: z.infer<typeof assignShiftSchema>) {
  await authorize(actor, "attendance:manage");
  const shift = await db.shift.findUnique({ where: { id: input.shiftId }, select: { id: true, isActive: true } });
  if (!shift || !shift.isActive) throw new NotFoundError("Shift");
  const where: Prisma.EmployeeWhereInput = input.employeeIds?.length
    ? { id: { in: input.employeeIds } }
    : input.employeeCodes?.length
      ? { employeeCode: { in: input.employeeCodes } }
      : { departmentId: input.departmentId, status: { not: "EXITED" } };
  const r = await db.employee.updateMany({ where, data: { shiftId: input.shiftId } });
  await audit(actor, "attendance.shift.assign", "Shift", input.shiftId, { after: { count: r.count, employeeIds: input.employeeIds, employeeCodes: input.employeeCodes, departmentId: input.departmentId } });
  return { updated: r.count };
}

// ── Holiday calendars ────────────────────────────────────────────────────

export async function listHolidayCalendars(actor: Actor, year?: number) {
  await authorize(actor, "attendance:read");
  const cals = await db.holidayCalendar.findMany({
    where: year ? { year } : {},
    orderBy: [{ year: "desc" }, { name: "asc" }],
    include: { location: { select: { id: true, name: true } }, holidays: { orderBy: { date: "asc" } } },
  });
  return cals.map((c) => ({ ...c, holidays: c.holidays.map((h) => ({ ...h, date: isoDate(h.date) })) }));
}

export async function createHolidayCalendar(actor: Actor, input: z.infer<typeof holidayCalendarSchema>) {
  await authorize(actor, "attendance:manage");
  const dup = await db.holidayCalendar.findFirst({ where: { year: input.year, locationId: input.locationId ?? null }, select: { id: true } });
  if (dup) throw new ConflictError("A calendar for this location and year already exists");
  const cal = await db.holidayCalendar.create({ data: { name: input.name, year: input.year, locationId: input.locationId ?? null } });
  await audit(actor, "attendance.calendar.create", "HolidayCalendar", cal.id, { after: cal });
  return cal;
}

export async function updateHolidayCalendar(actor: Actor, id: string, patch: z.infer<typeof holidayCalendarPatchSchema>) {
  await authorize(actor, "attendance:manage");
  const before = await db.holidayCalendar.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Holiday calendar");
  const cal = await db.holidayCalendar.update({ where: { id }, data: patch });
  await audit(actor, "attendance.calendar.update", "HolidayCalendar", id, { before, after: cal });
  return cal;
}

export async function deleteHolidayCalendar(actor: Actor, id: string) {
  await authorize(actor, "attendance:manage");
  const before = await db.holidayCalendar.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Holiday calendar");
  await db.holidayCalendar.delete({ where: { id } });
  await audit(actor, "attendance.calendar.delete", "HolidayCalendar", id, { before });
  return { deleted: true };
}

export async function addHolidays(actor: Actor, calendarId: string, input: z.infer<typeof holidaysBulkSchema>) {
  await authorize(actor, "attendance:manage");
  const cal = await db.holidayCalendar.findUnique({ where: { id: calendarId }, select: { id: true, year: true } });
  if (!cal) throw new NotFoundError("Holiday calendar");
  for (const h of input.holidays) if (h.date.getUTCFullYear() !== cal.year) throw new ValidationError(`${isoDate(h.date)} is not in ${cal.year}`);
  const r = await db.holiday.createMany({ data: input.holidays.map((h) => ({ ...h, calendarId })), skipDuplicates: true });
  await audit(actor, "attendance.holiday.add", "HolidayCalendar", calendarId, { after: { count: r.count, holidays: input.holidays } });
  return { added: r.count };
}

export async function deleteHoliday(actor: Actor, id: string) {
  await authorize(actor, "attendance:manage");
  const before = await db.holiday.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Holiday");
  await db.holiday.delete({ where: { id } });
  await audit(actor, "attendance.holiday.delete", "Holiday", id, { before });
  return { deleted: true };
}

/** Copy a calendar's holidays into another year (same month/day), creating the target calendar if needed. */
export async function cloneHolidayCalendar(actor: Actor, id: string, targetYear: number) {
  await authorize(actor, "attendance:manage");
  const src = await db.holidayCalendar.findUnique({ where: { id }, include: { holidays: true } });
  if (!src) throw new NotFoundError("Holiday calendar");
  if (src.year === targetYear) throw new ValidationError("Target year must differ from the source year");
  const target = await db.$transaction(async (tx) => {
    const existing = await tx.holidayCalendar.findFirst({ where: { year: targetYear, locationId: src.locationId } });
    const cal = existing ?? (await tx.holidayCalendar.create({ data: { name: src.name.replace(String(src.year), String(targetYear)) || `${src.name} ${targetYear}`, year: targetYear, locationId: src.locationId } }));
    const rows = src.holidays
      .map((h) => ({ calendarId: cal.id, name: h.name, isOptional: h.isOptional, date: new Date(Date.UTC(targetYear, h.date.getUTCMonth(), h.date.getUTCDate())) }))
      .filter((h) => h.date.getUTCFullYear() === targetYear);
    await tx.holiday.createMany({ data: rows, skipDuplicates: true });
    return cal;
  });
  await audit(actor, "attendance.calendar.clone", "HolidayCalendar", target.id, { after: { sourceId: id, targetYear } });
  return target;
}

// ── Jobs (no actor) ──────────────────────────────────────────────────────

const ACTIVE_STATUSES = ["ACTIVE", "ON_NOTICE", "ONBOARDING"] as const;

/**
 * End-of-day job: give every active employee without a record for `date` a
 * WEEK_OFF / HOLIDAY / ON_LEAVE / ABSENT record. Existing records (including
 * open ones with an IN but no OUT) are left untouched.
 */
export async function runDailyAttendanceJob(date: Date): Promise<{ date: string; created: number; byStatus: Record<string, number> }> {
  const day = toDateOnly(date);
  const employees = await db.employee.findMany({
    where: { status: { in: [...ACTIVE_STATUSES] }, joiningDate: { lte: day }, attendance: { none: { date: day } } },
    select: { id: true, shiftId: true, locationId: true },
  });
  const byStatus: Record<string, number> = { WEEK_OFF: 0, HOLIDAY: 0, ON_LEAVE: 0, ABSENT: 0 };
  if (employees.length === 0) return { date: isoDate(day), created: 0, byStatus };
  const [ctxFor, leaves] = await Promise.all([
    getCalendarContextsFor(employees, day, day),
    db.leaveRequest.findMany({ where: { status: "APPROVED", startDate: { lte: day }, endDate: { gte: day } }, select: { employeeId: true } }),
  ]);
  const onLeave = new Set(leaves.map((l) => l.employeeId));
  const rows: Prisma.AttendanceRecordCreateManyInput[] = employees.map((e) => {
    const kind = dayKind(day, ctxFor(e));
    const status: AttendanceStatus = kind ?? (onLeave.has(e.id) ? "ON_LEAVE" : "ABSENT");
    byStatus[status]++;
    return { employeeId: e.id, date: day, status, source: "SYSTEM", workMinutes: 0 };
  });
  let created = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const r = await db.attendanceRecord.createMany({ data: rows.slice(i, i + 1000), skipDuplicates: true });
    created += r.count;
  }
  return { date: isoDate(day), created, byStatus };
}

export interface MonthlyAttendanceSummary {
  employeeId: string;
  year: number;
  month: number;
  calendarDays: number;
  workingDays: number;
  presentDays: number;
  wfhDays: number;
  halfDays: number;
  /** Paid leave days (full = 1, half = 0.5). */
  leaveDays: number;
  /** Unpaid leave days (LOP leave type or isPaid=false), counted inside lopDays too. */
  unpaidLeaveDays: number;
  /** ABSENT + 0.5 × HALF_DAY + unpaid leave. */
  lopDays: number;
  holidays: number;
  weekOffs: number;
  absentDays: number;
  /** calendarDays - lopDays — the payroll contract. */
  payableDays: number;
}

/**
 * SHARED CONTRACT (payroll). Day classification for each calendar day:
 * attendance record status if present, else calendar (week-off/holiday),
 * else an approved leave, else ABSENT for past days. Future days are not counted.
 */
export async function monthlyAttendanceSummary(employeeId: string, year: number, month: number): Promise<MonthlyAttendanceSummary> {
  const { start, end, days: calendarDays } = monthRange(year, month);
  const [employee, ctx, records, leaves] = await Promise.all([
    db.employee.findUnique({ where: { id: employeeId }, select: { joiningDate: true, exitDate: true } }),
    getEmployeeCalendarContext(employeeId, start, end),
    db.attendanceRecord.findMany({ where: { employeeId, date: { gte: start, lte: end } }, select: { date: true, status: true } }),
    db.leaveRequest.findMany({
      where: { employeeId, status: "APPROVED", startDate: { lte: end }, endDate: { gte: start } },
      select: { startDate: true, endDate: true, startHalf: true, endHalf: true, leaveType: { select: { isPaid: true, code: true } } },
    }),
  ]);
  if (!employee) throw new NotFoundError("Employee");
  const byDate = new Map(records.map((r) => [isoDate(r.date), r.status]));
  const today = todayIst();
  const s: MonthlyAttendanceSummary = { employeeId, year, month, calendarDays, workingDays: countWorkingDays(start, end, ctx), presentDays: 0, wfhDays: 0, halfDays: 0, leaveDays: 0, unpaidLeaveDays: 0, lopDays: 0, holidays: 0, weekOffs: 0, absentDays: 0, payableDays: calendarDays };

  for (const d of eachDay(start, end)) {
    const kind = dayKind(d, ctx);
    if (kind === "WEEK_OFF") s.weekOffs++;
    else if (kind === "HOLIDAY") s.holidays++;
    const leave = leaves.find((l) => l.startDate.getTime() <= d.getTime() && l.endDate.getTime() >= d.getTime());
    const portion = leave && ((leave.startDate.getTime() === d.getTime() && leave.startHalf) || (leave.endDate.getTime() === d.getTime() && leave.endHalf)) ? 0.5 : 1;
    let status: AttendanceStatus | null = byDate.get(isoDate(d)) ?? null;
    if (!status) {
      if (kind) continue;
      if (leave) status = "ON_LEAVE";
      else if (d.getTime() <= today.getTime() && d.getTime() >= employee.joiningDate.getTime() && (!employee.exitDate || d.getTime() <= employee.exitDate.getTime())) status = "ABSENT";
      else continue;
    }
    switch (status) {
      case "PRESENT":
        s.presentDays++;
        break;
      case "WFH":
        s.wfhDays++;
        break;
      case "HALF_DAY":
        s.halfDays++;
        s.lopDays += 0.5;
        break;
      case "ABSENT":
        s.absentDays++;
        s.lopDays += 1;
        break;
      case "ON_LEAVE": {
        const paid = leave ? leave.leaveType.isPaid && leave.leaveType.code !== "LOP" : true;
        if (paid) s.leaveDays += portion;
        else {
          s.unpaidLeaveDays += portion;
          s.lopDays += portion;
        }
        break;
      }
      case "HOLIDAY":
        if (kind !== "HOLIDAY") s.holidays++;
        break;
      case "WEEK_OFF":
        if (kind !== "WEEK_OFF") s.weekOffs++;
        break;
    }
  }
  s.payableDays = Math.max(0, calendarDays - s.lopDays);
  return s;
}

/** Actor-facing wrapper for the payroll contract. */
export async function getMonthlySummary(actor: Actor, employeeId: string, year: number, month: number) {
  await authorize(actor, "attendance:read", { employeeId });
  return monthlyAttendanceSummary(employeeId, year, month);
}

/** Convenience used by pages: does the actor hold TEAM/ALL scope for attendance? */
export function attendanceScope(actor: Actor) {
  return scopeOf(actor, "attendance:read");
}

export type { CalendarContext, ShiftLite };
export { getDefaultShift, getEmployeeShift };
