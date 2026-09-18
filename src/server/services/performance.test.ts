import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { loadActor, type Actor } from "@/lib/rbac/authorize";
import { ForbiddenError } from "@/lib/errors";
import {
  calibrate,
  calibrationGrid,
  createCycle,
  createObjective,
  getCycle,
  getMyReview,
  givePraise,
  keyResultProgress,
  launchCycle,
  listObjectives,
  listPraise,
  moveToCalibration,
  objectiveOwnProgress,
  okrTree,
  parsePeriod,
  rollupProgress,
  submitSelfReview,
  updateKeyResult,
} from "@/server/services/performance";

async function actorFor(email: string): Promise<Actor> {
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`Seed user ${email} missing — run npm run db:seed`);
  const actor = await loadActor(user.id);
  if (!actor) throw new Error(`Cannot load actor ${email}`);
  return actor;
}

describe("OKR maths (pure)", () => {
  it("computes key result progress with clamping", () => {
    expect(keyResultProgress({ metricType: "NUMBER", startValue: 0, targetValue: 100, currentValue: 25 })).toBe(25);
    expect(keyResultProgress({ metricType: "NUMBER", startValue: 50, targetValue: 100, currentValue: 75 })).toBe(50);
    expect(keyResultProgress({ metricType: "NUMBER", startValue: 0, targetValue: 100, currentValue: 150 })).toBe(100);
    expect(keyResultProgress({ metricType: "NUMBER", startValue: 100, targetValue: 50, currentValue: 75 })).toBe(50); // decreasing target
    expect(keyResultProgress({ metricType: "BOOLEAN", startValue: 0, targetValue: 1, currentValue: 0 })).toBe(0);
    expect(keyResultProgress({ metricType: "BOOLEAN", startValue: 0, targetValue: 1, currentValue: 1 })).toBe(100);
  });
  it("weights key results and rolls up children", () => {
    const own = objectiveOwnProgress([
      { metricType: "NUMBER", startValue: 0, targetValue: 100, currentValue: 100, weight: 3 },
      { metricType: "NUMBER", startValue: 0, targetValue: 100, currentValue: 0, weight: 1 },
    ]);
    expect(own).toBe(75);
    expect(objectiveOwnProgress([])).toBeNull();
    expect(rollupProgress(50, [100, 0])).toBe(50);
    expect(rollupProgress(null, [40, 60])).toBe(50);
    expect(rollupProgress(null, [])).toBe(0);
  });
  it("parses periods", () => {
    expect(parsePeriod("2026-Q3")).toMatchObject({ label: "2026-Q3" });
    expect(parsePeriod("2026-Q3").start.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(parsePeriod("2026-Q3").end.toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(parsePeriod("2026").end.toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(parsePeriod("2026-H2").start.toISOString().slice(0, 10)).toBe("2026-07-01");
  });
});

describe("performance service (seeded DB)", () => {
  let employee: Actor;
  let manager: Actor;
  let admin: Actor;
  const objectiveIds: string[] = [];
  const cycleIds: string[] = [];
  const praiseIds: string[] = [];

  beforeAll(async () => {
    [employee, manager, admin] = await Promise.all([actorFor("employee@acme.example"), actorFor("manager@acme.example"), actorFor("admin@acme.example")]);
  });

  afterAll(async () => {
    if (objectiveIds.length) await db.objective.deleteMany({ where: { id: { in: objectiveIds } } });
    if (praiseIds.length) await db.feedback.deleteMany({ where: { id: { in: praiseIds } } });
    for (const id of cycleIds) {
      await db.notification.deleteMany({ where: { link: `/performance?tab=reviews&cycle=${id}` } });
      await db.reviewCycle.deleteMany({ where: { id } });
    }
  });

  it("employee creates an INDIVIDUAL objective with 2 KRs and progress is computed on update", async () => {
    const o = await createObjective(employee, {
      title: "[test] Ship onboarding revamp",
      level: "INDIVIDUAL",
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      periodEnd: new Date("2026-09-30T00:00:00.000Z"),
      keyResults: [
        { title: "Reduce time-to-first-task", metricType: "NUMBER", startValue: 10, targetValue: 5, weight: 1 },
        { title: "Docs published", metricType: "BOOLEAN", startValue: 0, targetValue: 1, weight: 1 },
      ],
    });
    objectiveIds.push(o.id);
    expect(o.ownerId).toBe(employee.employeeId);
    expect(o.keyResults).toHaveLength(2);
    expect(o.progress).toBe(0);

    const kr1 = o.keyResults.find((k) => k.metricType === "NUMBER")!;
    const after1 = await updateKeyResult(employee, kr1.id, { value: 7.5, note: "halfway" });
    expect(after1.keyResults.find((k) => k.id === kr1.id)!.progress).toBe(50);
    expect(after1.progress).toBe(25); // (50 + 0) / 2

    const kr2 = o.keyResults.find((k) => k.metricType === "BOOLEAN")!;
    const after2 = await updateKeyResult(employee, kr2.id, { value: 1 });
    expect(after2.progress).toBe(75); // (50 + 100) / 2
    const updates = await db.keyResultUpdate.count({ where: { keyResultId: kr1.id } });
    expect(updates).toBe(1);
  });

  it("employee cannot create a COMPANY objective", async () => {
    await expect(
      createObjective(employee, { title: "[test] Be the best", level: "COMPANY", periodStart: new Date("2026-01-01T00:00:00.000Z"), periodEnd: new Date("2026-12-31T00:00:00.000Z"), keyResults: [] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("manager can read the employee's objectives; admin sees them in the tree", async () => {
    const page = await listObjectives(manager, { page: 1, pageSize: 50, order: "desc", ownerId: employee.employeeId!, period: "2026-Q3" });
    expect(page.items.some((o) => objectiveIds.includes(o.id))).toBe(true);
    const tree = await okrTree(admin, "2026-Q3");
    expect(tree.period).toBe("2026-Q3");
    expect(tree.roots.some((r) => objectiveIds.includes(r.id))).toBe(true);
  });

  it("parent objective progress rolls up from children", async () => {
    const parent = await createObjective(admin, {
      title: "[test] Company objective",
      level: "COMPANY",
      ownerId: admin.employeeId ?? manager.employeeId!,
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      periodEnd: new Date("2026-09-30T00:00:00.000Z"),
      keyResults: [],
    });
    objectiveIds.push(parent.id);
    const child = await createObjective(manager, {
      title: "[test] Team objective",
      level: "TEAM",
      ownerId: employee.employeeId!,
      parentId: parent.id,
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      periodEnd: new Date("2026-09-30T00:00:00.000Z"),
      keyResults: [{ title: "Tickets closed", metricType: "NUMBER", startValue: 0, targetValue: 10, weight: 1 }],
    });
    objectiveIds.push(child.id);
    await updateKeyResult(manager, child.keyResults[0].id, { value: 4 });
    const p = await db.objective.findUniqueOrThrow({ where: { id: parent.id }, select: { progress: true } });
    expect(Number(p.progress)).toBe(40);
  });

  it("admin creates, launches, calibrates a review cycle; employee submits a self-review", async () => {
    const cycle = await createCycle(admin, {
      name: "[test] H1 2026 review",
      periodStart: new Date("2026-01-01T00:00:00.000Z"),
      periodEnd: new Date("2026-06-30T00:00:00.000Z"),
      selfReviewDue: new Date("2026-07-15T00:00:00.000Z"),
      managerReviewDue: new Date("2026-07-31T00:00:00.000Z"),
      ratingScale: 5,
      questions: [
        { id: "q1", text: "Key achievements", type: "TEXT" },
        { id: "q2", text: "Overall delivery", type: "RATING" },
      ],
      includeDepartmentIds: [],
    });
    cycleIds.push(cycle.id);
    expect(cycle.status).toBe("DRAFT");
    expect(cycle.questions).toHaveLength(2);

    const launched = await launchCycle(admin, cycle.id);
    expect(launched.reviews).toBeGreaterThan(100);
    const stats = await getCycle(admin, cycle.id);
    expect(stats.stats.total).toBe(launched.reviews);
    expect(stats.status).toBe("ACTIVE");

    const mine = await getMyReview(employee, cycle.id);
    expect(mine).not.toBeNull();
    expect(mine!.status).toBe("NOT_STARTED");
    expect(mine!.reviewerId).toBe(manager.employeeId);

    const submitted = await submitSelfReview(employee, mine!.id, { answers: [{ questionId: "q1", value: "Shipped X" }, { questionId: "q2", value: 4 }], rating: 4 });
    expect(submitted.status).toBe("SELF_SUBMITTED");
    await expect(submitSelfReview(employee, mine!.id, { answers: [], rating: 3 })).rejects.toThrow(/already/);
    // manager cannot submit a self-review for their report
    await expect(submitSelfReview(manager, mine!.id, { answers: [], rating: 3 })).rejects.toBeInstanceOf(ForbiddenError);

    await moveToCalibration(admin, cycle.id);
    const calibrated = await calibrate(admin, mine!.id, 4);
    expect(calibrated.status).toBe("CALIBRATED");
    expect(calibrated.finalRating).toBe(4);
    const grid = await calibrationGrid(admin, cycle.id);
    expect(grid.total).toBe(launched.reviews);
    expect(grid.byRating.find((r) => r.rating === 4)?.count).toBeGreaterThanOrEqual(1);
    await expect(calibrationGrid(employee, cycle.id)).rejects.toBeInstanceOf(ForbiddenError);
  }, 120_000);

  it("praise: public wall entry is visible; private feedback is not", async () => {
    const praise = await givePraise(manager, { toId: employee.employeeId!, message: "[test] great work", badge: "Ship It", kind: "PRAISE", isPublic: true });
    praiseIds.push(praise.id);
    const priv = await givePraise(manager, { toId: employee.employeeId!, message: "[test] private note", kind: "FEEDBACK", isPublic: true });
    praiseIds.push(priv.id);
    expect(priv.isPublic).toBe(false);
    const recruiter = await actorFor("recruiter@acme.example");
    const wall = await listPraise(recruiter, { page: 1, pageSize: 50, order: "desc" });
    expect(wall.items.some((p) => p.id === praise.id)).toBe(true);
    expect(wall.items.some((p) => p.id === priv.id)).toBe(false);
    const mine = await listPraise(employee, { page: 1, pageSize: 50, order: "desc", toId: employee.employeeId! });
    expect(mine.items.some((p) => p.id === priv.id)).toBe(true);
  });
});
