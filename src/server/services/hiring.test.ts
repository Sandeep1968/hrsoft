import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { loadActor, type Actor } from "@/lib/rbac/authorize";
import { ConflictError, ForbiddenError } from "@/lib/errors";

// Core HR's createEmployee is mocked: it inserts a bare Employee row (no user, salary or onboarding) so the
// hiredEmployeeId FK is satisfied, and the row is removed in afterAll.
const hireEmail = `new.hire.${Date.now()}@acme.example`;
vi.mock("@/server/services/employees", async () => {
  const { db } = await import("@/lib/db");
  return {
    createEmployee: vi.fn(async (_actor: unknown, input: { firstName: string; lastName: string; workEmail: string; joiningDate: Date }) => {
      const e = await db.employee.create({
        data: { employeeCode: `TEST-${Date.now().toString(36).toUpperCase()}`, firstName: input.firstName, lastName: input.lastName, displayName: `${input.firstName} ${input.lastName}`, workEmail: input.workEmail, joiningDate: input.joiningDate, status: "ONBOARDING" },
        select: { id: true, employeeCode: true },
      });
      return { id: e.id, employeeCode: e.employeeCode, userId: "00000000-0000-7000-8000-000000000002" };
    }),
  };
});

import { createEmployee } from "@/server/services/employees";
import {
  closeJob,
  convertToEmployee,
  createJob,
  createOffer,
  getPublicJob,
  hiringFunnel,
  listJobs,
  listMyInterviews,
  moveStage,
  pipeline,
  publicApply,
  publishJob,
  respondOffer,
  scheduleInterview,
  sendOffer,
  slugify,
  submitInterviewFeedback,
} from "@/server/services/hiring";

async function actorFor(email: string): Promise<Actor> {
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`Seed user ${email} missing — run npm run db:seed`);
  const actor = await loadActor(user.id);
  if (!actor) throw new Error(`Cannot load actor ${email}`);
  return actor;
}

describe("hiring service (seeded DB)", () => {
  let recruiter: Actor;
  let employee: Actor;
  let manager: Actor;
  let jobId: string;
  let applicationId: string;
  let candidateId: string;
  const candidateEmail = `test.candidate.${Date.now()}@example.com`;

  beforeAll(async () => {
    [recruiter, employee, manager] = await Promise.all([actorFor("recruiter@acme.example"), actorFor("employee@acme.example"), actorFor("manager@acme.example")]);
  });

  afterAll(async () => {
    // Application/interviews/offer cascade from the job; candidate and the mock-created employee are separate rows.
    if (jobId) await db.jobOpening.deleteMany({ where: { id: jobId } });
    if (candidateId) await db.candidate.deleteMany({ where: { id: candidateId } });
    await db.employee.deleteMany({ where: { workEmail: hireEmail } });
    await db.rateLimit.deleteMany({ where: { key: { startsWith: "careers" } } });
  });

  it("slugifies titles", () => {
    expect(slugify("Senior Backend Engineer (Node.js)")).toBe("senior-backend-engineer-node-js");
  });

  it("recruiter creates and publishes a job; employee cannot", async () => {
    const job = await createJob(recruiter, { title: "[test] Backend Engineer", description: "Build APIs for HRsoft and keep them fast.", employmentType: "FULL_TIME", openings: 1 });
    jobId = job.id;
    expect(job.status).toBe("DRAFT");
    expect(job.slug).toMatch(/^test-backend-engineer/);
    expect(job.recruiterId).toBe(recruiter.employeeId);
    await expect(createJob(employee, { title: "x", description: "not allowed at all", employmentType: "FULL_TIME", openings: 1 })).rejects.toBeInstanceOf(ForbiddenError);

    const published = await publishJob(recruiter, jobId);
    expect(published.status).toBe("OPEN");
    expect(published.isPublic).toBe(true);
    const pub = await getPublicJob(job.slug);
    expect(pub.title).toBe(job.title);
    const list = await listJobs(recruiter, { page: 1, pageSize: 10, order: "asc", status: "OPEN" });
    expect(list.items.some((j) => j.id === jobId)).toBe(true);
  });

  it("public apply creates candidate + application and rejects duplicates", async () => {
    const job = await db.jobOpening.findUniqueOrThrow({ where: { id: jobId }, select: { slug: true } });
    const r = await publicApply({ slug: job.slug, firstName: "Test", lastName: "Candidate", email: candidateEmail, phone: "9999999999", expectedCtc: 1800000, noticePeriodDays: 30 }, "127.0.0.1");
    applicationId = r.applicationId;
    candidateId = r.candidateId;
    const c = await db.candidate.findUniqueOrThrow({ where: { id: candidateId } });
    expect(c.source).toBe("CAREERS");
    expect(c.email).toBe(candidateEmail);
    await expect(publicApply({ slug: job.slug, firstName: "Test", lastName: "Candidate", email: candidateEmail }, "127.0.0.1")).rejects.toBeInstanceOf(ConflictError);
    const p = await pipeline(recruiter, jobId);
    expect(p.columns.find((c) => c.stage === "APPLIED")!.items.some((a) => a.id === applicationId)).toBe(true);
  });

  it("interviews: schedule, list for interviewer, feedback auto-completes", async () => {
    const i = await scheduleInterview(recruiter, applicationId, { title: "Tech round", round: 1, scheduledAt: new Date(Date.now() + 86_400_000), durationMinutes: 45, mode: "VIDEO", interviewerIds: [employee.employeeId!] });
    expect(i.status).toBe("SCHEDULED");
    const app = await db.application.findUniqueOrThrow({ where: { id: applicationId }, select: { stage: true } });
    expect(app.stage).toBe("INTERVIEW");
    const mine = await listMyInterviews(employee);
    expect(mine.some((x) => x.id === i.id)).toBe(true);
    await expect(submitInterviewFeedback(manager, i.id, { rating: 4, recommendation: "HIRE" })).rejects.toBeInstanceOf(ForbiddenError);
    await submitInterviewFeedback(employee, i.id, { rating: 5, recommendation: "STRONG_HIRE", notes: "solid" });
    const done = await db.interview.findUniqueOrThrow({ where: { id: i.id }, select: { status: true } });
    expect(done.status).toBe("COMPLETED");
  });

  it("offer flow: stage OFFER → create → send → accept → convert (mocked createEmployee) closes the job", async () => {
    const moved = await moveStage(recruiter, applicationId, { stage: "OFFER" });
    expect(moved.stage).toBe("OFFER");
    const designation = await db.designation.findFirst({ select: { id: true } });
    await expect(convertToEmployee(recruiter, applicationId, { workEmail: hireEmail })).rejects.toBeInstanceOf(ConflictError);
    const offer = await createOffer(recruiter, applicationId, { designationId: designation?.id ?? null, annualCtc: 1500000, joiningDate: new Date("2026-11-01T00:00:00.000Z") });
    expect(offer.status).toBe("DRAFT");
    const sent = await sendOffer(recruiter, offer.id);
    expect(sent.status).toBe("SENT");
    expect(sent.sentAt).not.toBeNull();
    await expect(sendOffer(recruiter, offer.id)).rejects.toBeInstanceOf(ConflictError);
    const accepted = await respondOffer(recruiter, offer.id, "ACCEPTED");
    expect(accepted.status).toBe("ACCEPTED");

    const converted = await convertToEmployee(recruiter, applicationId, { workEmail: hireEmail });
    const hired = await db.employee.findUniqueOrThrow({ where: { workEmail: hireEmail }, select: { id: true } });
    expect(converted.employeeId).toBe(hired.id);
    expect(converted.jobClosed).toBe(true);
    expect(vi.mocked(createEmployee)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(createEmployee).mock.calls[0][1];
    expect(call.workEmail).toBe(hireEmail);
    expect(call.annualCtc).toBe(1500000);
    expect(call.designationId).toBe(designation?.id);
    const job = await db.jobOpening.findUniqueOrThrow({ where: { id: jobId }, select: { status: true } });
    expect(job.status).toBe("CLOSED");
    const app = await db.application.findUniqueOrThrow({ where: { id: applicationId }, select: { stage: true } });
    expect(app.stage).toBe("HIRED");
    await expect(closeJob(employee, jobId)).rejects.toBeInstanceOf(ForbiddenError);
    const funnel = await hiringFunnel(recruiter);
    expect(funnel.stages.find((s) => s.stage === "HIRED")!.count).toBeGreaterThanOrEqual(1);
  });
});
