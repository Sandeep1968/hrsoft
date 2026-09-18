import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { loadActor, type Actor } from "@/lib/rbac/authorize";
import { addDays, isoDate, toDateOnly } from "@/lib/dates";
import { getEmployeeCalendarContext, isWorkingDay, todayIst } from "@/server/services/calendar";
import { applyLeave, cancelLeave, decideLeave, getBalances, previewLeave } from "@/server/services/leave";

async function actorFor(email: string): Promise<Actor> {
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`Seed user ${email} missing — run npm run db:seed`);
  const actor = await loadActor(user.id);
  if (!actor) throw new Error(`Cannot load actor ${email}`);
  return actor;
}

describe("leave service (seeded DB)", () => {
  let employee: Actor;
  let manager: Actor;
  let clId: string;
  let start: Date;
  let end: Date;
  const createdRequestIds: string[] = [];

  beforeAll(async () => {
    [employee, manager] = await Promise.all([actorFor("employee@acme.example"), actorFor("manager@acme.example")]);
    const cl = await db.leaveType.findUniqueOrThrow({ where: { code: "CL" }, select: { id: true } });
    clId = cl.id;
    // Find a Monday at least 10 days out where Mon+Tue are both working days and free of existing requests.
    const empId = employee.employeeId!;
    let probe = addDays(todayIst(), 10);
    const ctx = await getEmployeeCalendarContext(empId, probe, addDays(probe, 120));
    for (let i = 0; i < 100; i++, probe = addDays(probe, 1)) {
      if (probe.getUTCDay() !== 1) continue;
      const tue = addDays(probe, 1);
      if (!isWorkingDay(probe, ctx) || !isWorkingDay(tue, ctx)) continue;
      const clash = await db.leaveRequest.count({ where: { employeeId: empId, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: tue }, endDate: { gte: probe } } });
      if (clash === 0) break;
    }
    start = probe;
    end = addDays(probe, 1);
    // Make sure the balance can absorb 2 days.
    await db.leaveBalance.upsert({
      where: { employeeId_leaveTypeId_year: { employeeId: empId, leaveTypeId: clId, year: start.getUTCFullYear() } },
      create: { employeeId: empId, leaveTypeId: clId, year: start.getUTCFullYear(), accrued: 12 },
      update: {},
    });
  });

  afterAll(async () => {
    const empId = employee.employeeId!;
    for (const id of createdRequestIds) {
      const r = await db.leaveRequest.findUnique({ where: { id } });
      if (!r) continue;
      if (r.status === "APPROVED") {
        await db.leaveBalance.updateMany({ where: { employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, year: r.startDate.getUTCFullYear() }, data: { used: { decrement: r.days } } });
      }
      await db.leaveRequest.delete({ where: { id } });
    }
    await db.attendanceRecord.deleteMany({ where: { employeeId: empId, date: { gte: start, lte: end }, source: "SYSTEM", status: "ON_LEAVE" } });
    await db.notification.deleteMany({ where: { type: { in: ["leave.requested", "leave.decided", "leave.cancelled"] }, createdAt: { gte: new Date(Date.now() - 5 * 60_000) } } });
  });

  it("previews 2 working days", async () => {
    const p = await previewLeave(employee, { leaveTypeId: clId, startDate: start, endDate: end });
    expect(p.days).toBe(2);
    expect(p.errors).toEqual([]);
  });

  it("employee applies CL for 2 days → PENDING with days=2, manager approves → balance.used +2 and attendance ON_LEAVE", async () => {
    const empId = employee.employeeId!;
    const before = (await getBalances(employee, empId, start.getUTCFullYear())).find((b) => b.leaveTypeId === clId)!;

    const req = await applyLeave(employee, { leaveTypeId: clId, startDate: start, endDate: end, reason: "vitest leave" });
    createdRequestIds.push(req.id);
    expect(req.status).toBe("PENDING");
    expect(req.days).toBe(2);
    expect(req.approverId).toBe(manager.employeeId);

    // Employee cannot approve their own request (no leave:approve at all for EMPLOYEE role).
    await expect(decideLeave(employee, req.id, "APPROVED")).rejects.toThrow();

    // Overlapping application is rejected.
    await expect(applyLeave(employee, { leaveTypeId: clId, startDate: end, endDate: addDays(end, 1), reason: "overlap" })).rejects.toThrow(/Overlaps/);

    const decided = await decideLeave(manager, req.id, "APPROVED", "ok");
    expect(decided.status).toBe("APPROVED");
    expect(decided.decisionNote).toBe("ok");

    const after = (await getBalances(employee, empId, start.getUTCFullYear())).find((b) => b.leaveTypeId === clId)!;
    expect(after.used - before.used).toBe(2);
    expect(after.available).toBe(before.available - 2);

    const records = await db.attendanceRecord.findMany({ where: { employeeId: empId, date: { gte: start, lte: end } } });
    expect(records.map((r) => isoDate(r.date)).sort()).toEqual([isoDate(start), isoDate(end)]);
    expect(records.every((r) => r.status === "ON_LEAVE")).toBe(true);

    // Cancelling approved future leave restores the balance and removes the system records.
    const cancelled = await cancelLeave(employee, req.id);
    expect(cancelled.status).toBe("CANCELLED");
    const restored = (await getBalances(employee, empId, start.getUTCFullYear())).find((b) => b.leaveTypeId === clId)!;
    expect(restored.used).toBe(before.used);
    expect(await db.attendanceRecord.count({ where: { employeeId: empId, date: { gte: start, lte: end }, status: "ON_LEAVE" } })).toBe(0);
  });

  it("manager cannot approve their own request (TEAM scope)", async () => {
    const mgrId = manager.employeeId!;
    const ctx = await getEmployeeCalendarContext(mgrId, start, addDays(start, 60));
    let day = addDays(start, 14);
    for (let i = 0; i < 30; i++, day = addDays(day, 1)) {
      if (!isWorkingDay(day, ctx)) continue;
      const clash = await db.leaveRequest.count({ where: { employeeId: mgrId, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: day }, endDate: { gte: day } } });
      if (clash === 0) break;
    }
    await db.leaveBalance.upsert({
      where: { employeeId_leaveTypeId_year: { employeeId: mgrId, leaveTypeId: clId, year: day.getUTCFullYear() } },
      create: { employeeId: mgrId, leaveTypeId: clId, year: day.getUTCFullYear(), accrued: 12 },
      update: {},
    });
    const req = await applyLeave(manager, { leaveTypeId: clId, startDate: day, endDate: day, reason: "vitest self-approve" });
    createdRequestIds.push(req.id);
    await expect(decideLeave(manager, req.id, "APPROVED")).rejects.toThrow(/own/);
    expect(toDateOnly(req.startDate).getTime()).toBe(day.getTime());
  });
});
