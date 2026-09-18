import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/rbac/authorize";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { addDays, isoDate, weekStart } from "@/lib/dates";
import { actorFor, rand } from "./_test-helpers";
import { addMember, createProject, createTask } from "./projects";
import { decideTimesheet, getOrCreateWeek, listTimesheets, saveEntries, submitTimesheet } from "./timesheets";

describe("timesheets service (DB)", () => {
  let pm: Actor;
  let employee: Actor;
  let projectId: string;
  let taskId: string;
  let timesheetId: string;
  // A week far enough back to not collide with anything another module seeds.
  const week = weekStart(addDays(new Date(), -70));
  const code = rand("QA-");

  beforeAll(async () => {
    pm = await actorFor("pm@acme.example");
    employee = await actorFor("employee@acme.example");
    const p = await createProject(pm, { code, name: "QA timesheet project", status: "ACTIVE", isBillable: true, budgetHours: 100, description: null, clientId: null, managerId: null, startDate: null, endDate: null, hourlyRate: null });
    projectId = p.id;
    expect(p.managerId).toBe(pm.employeeId);
    await addMember(pm, projectId, { employeeId: employee.employeeId!, role: "MEMBER", allocationPct: 50 });
    const t = await createTask(pm, projectId, { name: "Build", isBillable: true, estimateHours: 40, status: "OPEN" });
    taskId = t.id;
  });

  afterAll(async () => {
    if (timesheetId) await db.timesheet.delete({ where: { id: timesheetId } }).catch(() => {});
    if (projectId) await db.project.delete({ where: { id: projectId } }).catch(() => {});
    await db.notification.deleteMany({ where: { type: { in: ["timesheet.submitted", "timesheet.decided", "project.member_added"] }, createdAt: { gte: addDays(new Date(), -1) }, OR: [{ userId: pm.userId }, { userId: employee.userId }] } });
  });

  it("creates the week for the employee with their assignable projects", async () => {
    const w = await getOrCreateWeek(employee, undefined, week);
    expect(w.timesheet.id).toBeTruthy();
    timesheetId = w.timesheet.id!;
    expect(w.timesheet.status).toBe("DRAFT");
    expect(w.timesheet.weekStart).toBe(isoDate(week));
    expect(w.projects.map((p) => p.id)).toContain(projectId);
    expect(w.canEdit).toBe(true);
  });

  it("saves 8h × 5 entries and recomputes the total", async () => {
    const entries = [0, 1, 2, 3, 4].map((d) => ({ projectId, taskId, date: addDays(week, d), hours: 8, isBillable: true, note: null }));
    const saved = await saveEntries(employee, timesheetId, entries);
    expect(saved.totalHours).toBe(40);
    expect(saved.entries).toHaveLength(5);
  });

  it("rejects more than 24h on a single day", async () => {
    const bad = [
      { projectId, taskId: null, date: week, hours: 20, isBillable: true, note: null },
      { projectId, taskId: null, date: week, hours: 5, isBillable: false, note: null },
    ];
    await expect(saveEntries(employee, timesheetId, bad)).rejects.toBeInstanceOf(ValidationError);
    // Previous entries are intact.
    const w = await getOrCreateWeek(employee, undefined, week);
    expect(w.timesheet.totalHours).toBe(40);
  });

  it("rejects entries for projects the employee is not on", async () => {
    const other = await createProject(pm, { code: rand("QA-"), name: "Other", status: "ACTIVE", isBillable: true, description: null, clientId: null, managerId: null, startDate: null, endDate: null, budgetHours: null, hourlyRate: null });
    try {
      await expect(saveEntries(employee, timesheetId, [{ projectId: other.id, taskId: null, date: week, hours: 1, isBillable: true, note: null }])).rejects.toBeInstanceOf(ForbiddenError);
    } finally {
      await db.project.delete({ where: { id: other.id } });
    }
  });

  it("submits and routes to the project manager", async () => {
    const s = await submitTimesheet(employee, timesheetId);
    expect(s.status).toBe("SUBMITTED");
    expect(s.approverId).toBe(pm.employeeId);
    const n = await db.notification.findFirst({ where: { userId: pm.userId, type: "timesheet.submitted" }, orderBy: { createdAt: "desc" } });
    expect(n).not.toBeNull();
  });

  it("the employee cannot approve their own sheet", async () => {
    await expect(decideTimesheet(employee, timesheetId, { decision: "APPROVED" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the PM sees it in their queue and approves it", async () => {
    const queue = await listTimesheets(pm, { status: "SUBMITTED", weekStart: week, page: 1, pageSize: 50, order: "desc" });
    expect(queue.items.some((t) => t.id === timesheetId)).toBe(true);
    const d = await decideTimesheet(pm, timesheetId, { decision: "APPROVED", note: "Looks good" });
    expect(d.status).toBe("APPROVED");
    expect(d.decisionNote).toBe("Looks good");
    expect(d.approverId).toBe(pm.employeeId);
    // Approved sheets are locked.
    await expect(saveEntries(employee, timesheetId, [])).rejects.toThrow();
  });
});
