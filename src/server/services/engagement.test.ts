import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { loadActor, type Actor } from "@/lib/rbac/authorize";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import { closeSurvey, createAnnouncement, createSurvey, deleteAnnouncement, engagementDashboard, getSurveyForRespondent, launchSurvey, listAnnouncements, listSurveys, npsScore, respond, surveyResults, updateSurvey } from "@/server/services/engagement";

async function actorFor(email: string): Promise<Actor> {
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`Seed user ${email} missing — run npm run db:seed`);
  const actor = await loadActor(user.id);
  if (!actor) throw new Error(`Cannot load actor ${email}`);
  return actor;
}

describe("NPS maths", () => {
  it("scores promoters minus detractors", () => {
    expect(npsScore([])).toBeNull();
    expect(npsScore([10, 9, 8, 7, 6, 0])).toBe(0); // 2 promoters, 2 detractors of 6 → 0
    expect(npsScore([10, 10, 10, 5])).toBe(50);
  });
});

describe("engagement service (seeded DB)", () => {
  let hr: Actor;
  let employee: Actor;
  let manager: Actor;
  let surveyId: string;
  let announcementId: string;

  beforeAll(async () => {
    [hr, employee, manager] = await Promise.all([actorFor("hr@acme.example"), actorFor("employee@acme.example"), actorFor("manager@acme.example")]);
  });

  afterAll(async () => {
    if (surveyId) {
      await db.notification.deleteMany({ where: { link: `/engagement?tab=surveys&survey=${surveyId}` } });
      await db.survey.deleteMany({ where: { id: surveyId } });
    }
    if (announcementId) await db.announcement.deleteMany({ where: { id: announcementId } });
  });

  it("announcements: manage creates, employees only see ones addressed to them", async () => {
    const otherDept = await db.department.findFirst({ where: { NOT: { employees: { some: { id: employee.employeeId! } } } }, select: { id: true } });
    const a = await createAnnouncement(hr, { title: "[test] Only for another department", body: "hidden", audienceDepartmentIds: [otherDept!.id], isPinned: true });
    announcementId = a.id;
    await expect(createAnnouncement(employee, { title: "x", body: "y", audienceDepartmentIds: [], isPinned: false })).rejects.toBeInstanceOf(ForbiddenError);
    const forEmployee = await listAnnouncements(employee, { page: 1, pageSize: 50, order: "desc" });
    expect(forEmployee.items.some((x) => x.id === a.id)).toBe(false);
    const forHr = await listAnnouncements(hr, { page: 1, pageSize: 50, order: "desc" });
    expect(forHr.items.some((x) => x.id === a.id)).toBe(true);
    await deleteAnnouncement(hr, a.id);
    announcementId = "";
  });

  it("survey: create → launch → respond once (second response conflicts) → results honour anonymity threshold", async () => {
    const s = await createSurvey(hr, {
      title: "[test] eNPS pulse",
      type: "ENPS",
      isAnonymous: true,
      targetDepartmentIds: [],
      questions: [
        { text: "How likely are you to recommend Acme as a place to work?", type: "NPS", options: [], required: true },
        { text: "How satisfied are you with your manager?", type: "RATING", options: [], required: true },
        { text: "Preferred work mode", type: "CHOICE", options: ["Office", "Hybrid", "Remote"], required: false },
        { text: "Anything else?", type: "TEXT", options: [], required: false },
      ],
    });
    surveyId = s.id;
    expect(s.status).toBe("DRAFT");
    expect(s.questions).toHaveLength(4);
    const updated = await updateSurvey(hr, s.id, { description: "Quarterly pulse" });
    expect(updated.description).toBe("Quarterly pulse");

    await expect(respond(employee, s.id, { answers: {} })).rejects.toBeInstanceOf(ConflictError); // not active yet
    const launched = await launchSurvey(hr, s.id);
    expect(launched.notified).toBeGreaterThan(100);
    await expect(updateSurvey(hr, s.id, { title: "nope" })).rejects.toBeInstanceOf(ConflictError);

    const forEmployee = await listSurveys(employee);
    const mine = forEmployee.find((x) => x.id === s.id);
    expect(mine?.responded).toBe(false);
    const q = (await getSurveyForRespondent(employee, s.id)).questions;
    const [nps, rating, choice, text] = q.map((x) => x.id);

    await expect(respond(employee, s.id, { answers: { [nps]: 11, [rating]: 4 } })).rejects.toThrow(/0 to 10/);
    await expect(respond(employee, s.id, { answers: { [rating]: 4 } })).rejects.toThrow(/required/);
    const r = await respond(employee, s.id, { answers: { [nps]: 9, [rating]: 4, [choice]: "Hybrid", [text]: "Keep it up" } });
    expect(r.id).toBeTruthy();
    await expect(respond(employee, s.id, { answers: { [nps]: 9, [rating]: 4 } })).rejects.toBeInstanceOf(ConflictError);
    await respond(manager, s.id, { answers: { [nps]: 3, [rating]: 2 } });

    // anonymous: employeeId is not stored
    const stored = await db.surveyResponse.findMany({ where: { surveyId: s.id }, select: { employeeId: true } });
    expect(stored).toHaveLength(2);
    expect(stored.every((x) => x.employeeId === null)).toBe(true);

    expect((await listSurveys(employee)).find((x) => x.id === s.id)?.responded).toBe(true);
    await expect(surveyResults(employee, s.id)).rejects.toBeInstanceOf(ForbiddenError);
    const results = await surveyResults(hr, s.id);
    expect(results.responses).toBe(2);
    expect(results.responseRate).not.toBeNull();
    expect(results.nps).toBe(0); // one promoter, one detractor
    const ratingQ = results.questions.find((x) => x.id === rating)!;
    expect(ratingQ.average).toBe(3);
    expect(ratingQ.distribution.find((d) => d.label === "4")?.count).toBe(1);
    expect(results.questions.find((x) => x.id === choice)!.distribution.find((d) => d.label === "Hybrid")?.count).toBe(1);
    expect(results.questions.find((x) => x.id === text)!.texts).toEqual(["Keep it up"]);
    // both respondents share a department but only 2 responses → suppressed (threshold 5)
    expect(results.departments).toHaveLength(0);
    expect(results.suppressedDepartments).toBeGreaterThanOrEqual(1);

    const dash = await engagementDashboard(hr);
    expect(dash.trend.some((t) => t.surveyId === s.id && t.nps === 0)).toBe(true);
    const closed = await closeSurvey(hr, s.id);
    expect(closed.status).toBe("CLOSED");
    await expect(respond(employee, s.id, { answers: { [nps]: 9, [rating]: 4 } })).rejects.toBeInstanceOf(ConflictError);
  }, 120_000);
});
