import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { loadActor, type Actor } from "@/lib/rbac/authorize";
import { addDays, monthRange } from "@/lib/dates";
import { getEmployeeShift, todayIst } from "@/server/services/calendar";
import { getMonth, getToday, monthlyAttendanceSummary, punch, runDailyAttendanceJob } from "@/server/services/attendance";

async function actorFor(email: string): Promise<Actor> {
  const user = await db.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const actor = await loadActor(user.id);
  if (!actor) throw new Error(`Cannot load actor ${email}`);
  return actor;
}

describe("attendance service (seeded DB)", () => {
  let employee: Actor;
  let empId: string;
  const today = todayIst();
  let existing: { firstIn: Date | null; lastOut: Date | null; workMinutes: number; lateMinutes: number; status: string; source: string } | null = null;

  beforeAll(async () => {
    employee = await actorFor("employee@acme.example");
    empId = employee.employeeId!;
    const rec = await db.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: empId, date: today } } });
    existing = rec ? { firstIn: rec.firstIn, lastOut: rec.lastOut, workMinutes: rec.workMinutes, lateMinutes: rec.lateMinutes, status: rec.status, source: rec.source } : null;
    // Start from a clean slate for today's record.
    await db.attendanceRecord.deleteMany({ where: { employeeId: empId, date: today } });
  });

  afterAll(async () => {
    await db.attendanceRecord.deleteMany({ where: { employeeId: empId, date: today } });
    if (existing) {
      await db.attendanceRecord.create({ data: { employeeId: empId, date: today, ...existing, status: existing.status as never, source: existing.source as never } });
    }
  });

  it("punch IN then OUT updates firstIn/lastOut/workMinutes and status", async () => {
    const shift = await getEmployeeShift(empId);
    const t0 = await getToday(employee);
    expect(t0.record).toBeNull();
    expect(t0.clockedIn).toBe(false);

    await expect(punch(employee, { type: "OUT" })).rejects.toThrow(/not clocked in/);

    const inRes = await punch(employee, { type: "IN", latitude: 17.44, longitude: 78.38 });
    expect(inRes.clockedIn).toBe(true);
    expect(inRes.record?.firstIn).toBeTruthy();
    expect(inRes.record?.status).toBe("PRESENT"); // provisional while open

    await expect(punch(employee, { type: "IN" })).rejects.toThrow(/already clocked in/);

    // Back-date the IN punch so the OUT produces measurable minutes.
    const rec = await db.attendanceRecord.findUniqueOrThrow({ where: { employeeId_date: { employeeId: empId, date: today } }, include: { punches: true } });
    const backdated = new Date(Date.now() - 5 * 60 * 60_000);
    await db.attendancePunch.update({ where: { id: rec.punches[0].id }, data: { time: backdated } });

    const outRes = await punch(employee, { type: "OUT" });
    expect(outRes.clockedIn).toBe(false);
    expect(outRes.record?.lastOut).toBeTruthy();
    expect(outRes.record?.workMinutes).toBeGreaterThanOrEqual(299);
    expect(outRes.record?.workMinutes).toBeLessThanOrEqual(301);
    expect(outRes.record?.status).toBe(300 >= shift.fullDayMinutes ? "PRESENT" : 300 >= shift.halfDayMinutes ? "HALF_DAY" : "ABSENT");
    expect(outRes.punches).toHaveLength(2);

    const month = await getMonth(employee, empId, today.getUTCFullYear(), today.getUTCMonth() + 1);
    const day = month.days.find((d) => d.date === today.toISOString().slice(0, 10))!;
    expect(day.recordId).toBe(rec.id);
    expect(day.workMinutes).toBe(outRes.record?.workMinutes);
  });

  it("monthlyAttendanceSummary returns consistent totals on seeded data", async () => {
    const lastMonth = addDays(monthRange(today.getUTCFullYear(), today.getUTCMonth() + 1).start, -1);
    const y = lastMonth.getUTCFullYear();
    const m = lastMonth.getUTCMonth() + 1;
    const s = await monthlyAttendanceSummary(empId, y, m);
    expect(s.calendarDays).toBe(monthRange(y, m).days);
    expect(s.workingDays).toBeGreaterThan(0);
    expect(s.workingDays).toBeLessThanOrEqual(s.calendarDays);
    expect(s.lopDays).toBeCloseTo(s.absentDays + 0.5 * s.halfDays + s.unpaidLeaveDays, 5);
    expect(s.payableDays).toBeCloseTo(s.calendarDays - s.lopDays, 5);
    // Every counted day is at most one calendar day.
    const counted = s.presentDays + s.wfhDays + s.halfDays + s.leaveDays + s.unpaidLeaveDays + s.absentDays + s.holidays + s.weekOffs;
    expect(counted).toBeLessThanOrEqual(s.calendarDays);
    expect(counted).toBeGreaterThan(0);
  });

  it("runDailyAttendanceJob is idempotent and only fills gaps", async () => {
    const probe = addDays(today, -1);
    const first = await runDailyAttendanceJob(probe);
    const second = await runDailyAttendanceJob(probe);
    expect(second.created).toBe(0);
    expect(first.created).toBeGreaterThanOrEqual(0);
    expect(Object.values(first.byStatus).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(first.created);
  });
});
