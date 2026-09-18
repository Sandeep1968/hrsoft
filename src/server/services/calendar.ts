import "server-only";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { addDays, eachDay, isoDate, toDateOnly } from "@/lib/dates";

/**
 * Calendar helpers shared by attendance, leave and payroll.
 *
 * A "working day" is a day that is neither a weekly off (from the employee's
 * shift, default Sat/Sun) nor a mandatory holiday in the employee's location
 * calendar (fallback: the calendar with `locationId: null`). Optional
 * (restricted) holidays are treated as working days.
 */

export interface HolidayInfo {
  name: string;
  isOptional: boolean;
}

export interface CalendarContext {
  weeklyOffDays: number[];
  /** isoDate (YYYY-MM-DD) → holiday */
  holidays: Map<string, HolidayInfo>;
}

export const IST_OFFSET_MINUTES = 330;

/** Today as a date-only value in Asia/Kolkata. */
export function todayIst(): Date {
  return toDateOnly(new Date(Date.now() + IST_OFFSET_MINUTES * 60_000));
}

export const DEFAULT_WEEKLY_OFF = [0, 6];

// ── Pure helpers (unit-tested) ───────────────────────────────────────────

export function isWeekOff(date: Date, ctx: Pick<CalendarContext, "weeklyOffDays">): boolean {
  return ctx.weeklyOffDays.includes(toDateOnly(date).getUTCDay());
}

export function holidayOn(date: Date, ctx: Pick<CalendarContext, "holidays">): HolidayInfo | undefined {
  return ctx.holidays.get(isoDate(toDateOnly(date)));
}

/** Mandatory holiday (optional holidays count as working days). */
export function isHoliday(date: Date, ctx: Pick<CalendarContext, "holidays">): boolean {
  const h = holidayOn(date, ctx);
  return Boolean(h && !h.isOptional);
}

export function isWorkingDay(date: Date, ctx: CalendarContext): boolean {
  return !isWeekOff(date, ctx) && !isHoliday(date, ctx);
}

export function countWorkingDays(from: Date, to: Date, ctx: CalendarContext): number {
  let n = 0;
  for (const d of eachDay(from, to)) if (isWorkingDay(d, ctx)) n++;
  return n;
}

/** Non-working classification for a date, or null when it is a working day. */
export function dayKind(date: Date, ctx: CalendarContext): "WEEK_OFF" | "HOLIDAY" | null {
  if (isWeekOff(date, ctx)) return "WEEK_OFF";
  if (isHoliday(date, ctx)) return "HOLIDAY";
  return null;
}

/** Working days in range with optional half-day trimming at either end (leave-day counting). */
export function countLeaveDays(from: Date, to: Date, ctx: CalendarContext, opts: { startHalf?: boolean; endHalf?: boolean } = {}): number {
  const start = toDateOnly(from);
  const end = toDateOnly(to);
  if (end.getTime() < start.getTime()) return 0;
  let days = countWorkingDays(start, end, ctx);
  if (days === 0) return 0;
  if (start.getTime() === end.getTime()) {
    return opts.startHalf || opts.endHalf ? 0.5 : 1;
  }
  if (opts.startHalf && isWorkingDay(start, ctx)) days -= 0.5;
  if (opts.endHalf && isWorkingDay(end, ctx)) days -= 0.5;
  return days;
}

/** Years touched by a date range (inclusive). */
export function yearsInRange(from: Date, to: Date): number[] {
  const a = toDateOnly(from).getUTCFullYear();
  const b = toDateOnly(to).getUTCFullYear();
  const years: number[] = [];
  for (let y = a; y <= b; y++) years.push(y);
  return years;
}

// ── DB-backed loaders ────────────────────────────────────────────────────

/** Resolve an employee id from an id or an employee code (for admin search boxes). */
export async function resolveEmployeeId(input: { employeeId?: string | null; employeeCode?: string | null }): Promise<string> {
  if (input.employeeId) return input.employeeId;
  if (input.employeeCode) {
    const e = await db.employee.findFirst({ where: { OR: [{ employeeCode: input.employeeCode.trim() }, { workEmail: input.employeeCode.trim().toLowerCase() }] }, select: { id: true } });
    if (!e) throw new NotFoundError("Employee");
    return e.id;
  }
  throw new NotFoundError("Employee");
}

export interface ShiftLite {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  graceMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
  weeklyOffDays: number[];
  isDefault: boolean;
}

const shiftSelect = { id: true, name: true, startTime: true, endTime: true, breakMinutes: true, graceMinutes: true, fullDayMinutes: true, halfDayMinutes: true, weeklyOffDays: true, isDefault: true } as const;

export const FALLBACK_SHIFT: ShiftLite = {
  id: "",
  name: "General",
  startTime: "09:00",
  endTime: "18:00",
  breakMinutes: 60,
  graceMinutes: 15,
  fullDayMinutes: 480,
  halfDayMinutes: 240,
  weeklyOffDays: DEFAULT_WEEKLY_OFF,
  isDefault: true,
};

export async function getDefaultShift(): Promise<ShiftLite> {
  const s = (await db.shift.findFirst({ where: { isDefault: true, isActive: true }, select: shiftSelect })) ?? (await db.shift.findFirst({ where: { isActive: true }, select: shiftSelect }));
  return s ?? FALLBACK_SHIFT;
}

/** Resolve the shift an employee works (their own, else the default). */
export async function getEmployeeShift(employeeId: string): Promise<ShiftLite> {
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { shift: { select: shiftSelect } } });
  if (!emp) throw new NotFoundError("Employee");
  return emp.shift ?? (await getDefaultShift());
}

/**
 * Holidays for a location across the given years. Location-specific
 * calendars win over the fallback (`locationId: null`) calendar per year.
 */
export async function loadHolidays(locationId: string | null, years: number[]): Promise<Map<string, HolidayInfo>> {
  const calendars = await db.holidayCalendar.findMany({
    where: { year: { in: years }, OR: [{ locationId: null }, ...(locationId ? [{ locationId }] : [])] },
    select: { year: true, locationId: true, holidays: { select: { date: true, name: true, isOptional: true } } },
  });
  const holidays = new Map<string, HolidayInfo>();
  for (const year of years) {
    const specific = locationId ? calendars.find((c) => c.year === year && c.locationId === locationId) : undefined;
    const cal = specific ?? calendars.find((c) => c.year === year && c.locationId === null);
    for (const h of cal?.holidays ?? []) holidays.set(isoDate(h.date), { name: h.name, isOptional: h.isOptional });
  }
  return holidays;
}

export async function getEmployeeCalendarContext(employeeId: string, from: Date, to: Date): Promise<CalendarContext> {
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { locationId: true, shift: { select: { weeklyOffDays: true } } } });
  if (!emp) throw new NotFoundError("Employee");
  const weeklyOffDays = emp.shift?.weeklyOffDays ?? (await getDefaultShift()).weeklyOffDays;
  const holidays = await loadHolidays(emp.locationId, yearsInRange(from, to));
  return { weeklyOffDays, holidays };
}

/**
 * Batch variant for jobs: one context per distinct (shiftId, locationId)
 * combination so 2,000 employees need only a handful of queries.
 */
export async function getCalendarContextsFor(
  employees: { shiftId: string | null; locationId: string | null }[],
  from: Date,
  to: Date,
): Promise<(e: { shiftId: string | null; locationId: string | null }) => CalendarContext> {
  const years = yearsInRange(from, to);
  const shiftIds = [...new Set(employees.map((e) => e.shiftId).filter((x): x is string => Boolean(x)))];
  const locationIds = [...new Set(employees.map((e) => e.locationId))];
  const [shifts, defaultShift] = await Promise.all([
    shiftIds.length ? db.shift.findMany({ where: { id: { in: shiftIds } }, select: { id: true, weeklyOffDays: true } }) : [],
    getDefaultShift(),
  ]);
  const offByShift = new Map(shifts.map((s) => [s.id, s.weeklyOffDays]));
  const holidaysByLocation = new Map<string | null, Map<string, HolidayInfo>>();
  await Promise.all(locationIds.map(async (loc) => holidaysByLocation.set(loc, await loadHolidays(loc, years))));
  return (e) => ({
    weeklyOffDays: (e.shiftId && offByShift.get(e.shiftId)) || defaultShift.weeklyOffDays,
    holidays: holidaysByLocation.get(e.locationId) ?? new Map(),
  });
}

/** Upcoming holidays (mandatory + optional) for an employee's location. */
export async function upcomingHolidays(locationId: string | null, from: Date, limit = 8) {
  const to = addDays(from, 365);
  const holidays = await loadHolidays(locationId, yearsInRange(from, to));
  return [...holidays.entries()]
    .filter(([d]) => d >= isoDate(from))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(0, limit)
    .map(([date, h]) => ({ date, ...h }));
}
