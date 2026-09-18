import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notifyMany } from "@/lib/notify";
import { sendMail } from "@/lib/mail";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/ratelimit";
import { makeKey, putFile, downloadUrl, ALLOWED_MIME } from "@/lib/storage";
import { randomToken } from "@/lib/crypto";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { paginate, paginationSchema, toPage, zDateOnly, zMoney, zUuid } from "@/lib/api";
import { type Actor, authorize, can, requireEmployee } from "@/lib/rbac/authorize";
import { Prisma, type ApplicationStage, type OfferStatus } from "@/generated/prisma/client";
import { createEmployee } from "@/server/services/employees";

// ── Constants & schemas ────────────────────────────────────────────────

export const JOB_STATUSES = ["DRAFT", "OPEN", "ON_HOLD", "CLOSED"] as const;
export const STAGES = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED", "REJECTED", "WITHDRAWN"] as const;
export const PIPELINE_STAGES: ApplicationStage[] = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED", "REJECTED"];
export const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN", "CONSULTANT"] as const;
export const INTERVIEW_MODES = ["ONSITE", "VIDEO", "PHONE"] as const;
export const RECOMMENDATIONS = ["STRONG_HIRE", "HIRE", "NO_HIRE", "STRONG_NO_HIRE"] as const;

export const jobSchema = z.object({
  title: z.string().trim().min(2).max(150),
  departmentId: zUuid.optional().nullable(),
  designationId: zUuid.optional().nullable(),
  locationId: zUuid.optional().nullable(),
  employmentType: z.enum(EMPLOYMENT_TYPES).default("FULL_TIME"),
  openings: z.coerce.number().int().min(1).max(500).default(1),
  description: z.string().trim().min(10).max(20000),
  requirements: z.string().trim().max(20000).optional().nullable(),
  minExperience: z.coerce.number().int().min(0).max(50).optional().nullable(),
  maxExperience: z.coerce.number().int().min(0).max(50).optional().nullable(),
  salaryMin: zMoney.optional().nullable(),
  salaryMax: zMoney.optional().nullable(),
  hiringManagerId: zUuid.optional().nullable(),
  recruiterId: zUuid.optional().nullable(),
});
export type JobInput = z.infer<typeof jobSchema>;
export const updateJobSchema = jobSchema.partial().extend({ status: z.enum(["DRAFT", "ON_HOLD", "OPEN"]).optional() });
export const listJobsSchema = paginationSchema.extend({ status: z.enum(JOB_STATUSES).optional() });

export const candidateSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(200).transform((s) => s.toLowerCase()),
  phone: z.string().trim().max(30).optional().nullable(),
  linkedinUrl: z.string().trim().url().max(300).optional().nullable().or(z.literal("")),
  currentCompany: z.string().trim().max(150).optional().nullable(),
  currentCtc: zMoney.optional().nullable(),
  expectedCtc: zMoney.optional().nullable(),
  noticePeriodDays: z.coerce.number().int().min(0).max(365).optional().nullable(),
  source: z.string().trim().max(60).optional().nullable(),
  skills: z.array(z.string().trim().min(1).max(40)).max(50).default([]),
});
export type CandidateInput = z.infer<typeof candidateSchema>;
export const updateCandidateSchema = candidateSchema.partial();

export const applySchema = z.object({ jobId: zUuid, candidateId: zUuid });
export const moveStageSchema = z.object({ stage: z.enum(["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"]), rejectionReason: z.string().trim().max(1000).optional().nullable() });
export const rateApplicationSchema = z.object({ rating: z.coerce.number().int().min(1).max(5).optional().nullable(), notes: z.string().trim().max(4000).optional().nullable() });

export const scheduleInterviewSchema = z.object({
  title: z.string().trim().min(1).max(150),
  round: z.coerce.number().int().min(1).max(20).default(1),
  scheduledAt: z.coerce.date(),
  durationMinutes: z.coerce.number().int().min(15).max(480).default(60),
  mode: z.enum(INTERVIEW_MODES).default("VIDEO"),
  meetingLink: z.string().trim().url().max(500).optional().nullable().or(z.literal("")),
  interviewerIds: z.array(zUuid).min(1).max(10),
});
export const interviewFeedbackSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  recommendation: z.enum(RECOMMENDATIONS),
  notes: z.string().trim().max(4000).optional().nullable(),
});

export const offerSchema = z.object({ designationId: zUuid.optional().nullable(), annualCtc: zMoney.min(1), joiningDate: zDateOnly });
export const respondOfferSchema = z.object({ response: z.enum(["ACCEPTED", "DECLINED"]) });
export const convertSchema = z.object({
  workEmail: z.string().trim().email().max(200).transform((s) => s.toLowerCase()),
  departmentId: zUuid.optional().nullable(),
  locationId: zUuid.optional().nullable(),
  managerId: zUuid.optional().nullable(),
});

export const publicApplySchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(200).transform((s) => s.toLowerCase()),
  phone: z.string().trim().max(30).optional().nullable(),
  linkedinUrl: z.string().trim().url().max(300).optional().nullable().or(z.literal("")),
  currentCompany: z.string().trim().max(150).optional().nullable(),
  expectedCtc: zMoney.optional().nullable(),
  noticePeriodDays: z.coerce.number().int().min(0).max(365).optional().nullable(),
});
export interface UploadedFile {
  buffer: Buffer;
  mimeType: string;
  name: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

const money = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : Number(d));

export function slugify(title: string): string {
  return title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "job";
}

async function uniqueSlug(title: string): Promise<string> {
  const base = slugify(title);
  const exists = await db.jobOpening.findUnique({ where: { slug: base }, select: { id: true } });
  if (!exists) return base;
  return `${base}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || Date.now().toString(36)}`;
}

const jobSelect = {
  id: true,
  title: true,
  slug: true,
  departmentId: true,
  department: { select: { name: true } },
  designationId: true,
  designation: { select: { name: true } },
  locationId: true,
  location: { select: { name: true, city: true } },
  employmentType: true,
  openings: true,
  description: true,
  requirements: true,
  minExperience: true,
  maxExperience: true,
  salaryMin: true,
  salaryMax: true,
  status: true,
  isPublic: true,
  hiringManagerId: true,
  hiringManager: { select: { displayName: true } },
  recruiterId: true,
  recruiter: { select: { displayName: true } },
  publishedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.JobOpeningSelect;
type JobRow = Prisma.JobOpeningGetPayload<{ select: typeof jobSelect }>;

function serializeJob(j: JobRow, counts: Partial<Record<ApplicationStage, number>> = {}) {
  return {
    ...j,
    departmentName: j.department?.name ?? null,
    designationName: j.designation?.name ?? null,
    locationName: j.location ? `${j.location.name}${j.location.city ? `, ${j.location.city}` : ""}` : null,
    hiringManagerName: j.hiringManager?.displayName ?? null,
    recruiterName: j.recruiter?.displayName ?? null,
    salaryMin: money(j.salaryMin),
    salaryMax: money(j.salaryMax),
    publishedAt: j.publishedAt?.toISOString() ?? null,
    closedAt: j.closedAt?.toISOString() ?? null,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
    counts,
    totalApplications: Object.values(counts).reduce((a, b) => a + (b ?? 0), 0),
    department: undefined,
    designation: undefined,
    location: undefined,
    hiringManager: undefined,
    recruiter: undefined,
  };
}
export type JobDto = ReturnType<typeof serializeJob>;

function serializeCandidate<T extends { currentCtc: Prisma.Decimal | null; expectedCtc: Prisma.Decimal | null; createdAt: Date }>(c: T) {
  return { ...c, currentCtc: money(c.currentCtc), expectedCtc: money(c.expectedCtc), createdAt: c.createdAt.toISOString() };
}

async function stageCounts(jobIds: string[]) {
  if (jobIds.length === 0) return new Map<string, Partial<Record<ApplicationStage, number>>>();
  const grouped = await db.application.groupBy({ by: ["jobId", "stage"], where: { jobId: { in: jobIds } }, _count: { _all: true } });
  const map = new Map<string, Partial<Record<ApplicationStage, number>>>();
  for (const g of grouped) {
    const m = map.get(g.jobId) ?? {};
    m[g.stage] = g._count._all;
    map.set(g.jobId, m);
  }
  return map;
}

// ── Jobs ───────────────────────────────────────────────────────────────

export async function createJob(actor: Actor, input: JobInput) {
  await authorize(actor, "hiring:write");
  if (input.minExperience != null && input.maxExperience != null && input.maxExperience < input.minExperience) throw new ValidationError("maxExperience must be ≥ minExperience");
  if (input.salaryMin != null && input.salaryMax != null && input.salaryMax < input.salaryMin) throw new ValidationError("salaryMax must be ≥ salaryMin");
  const slug = await uniqueSlug(input.title);
  const job = await db.jobOpening.create({ data: { ...input, slug, recruiterId: input.recruiterId ?? actor.employeeId ?? null }, select: jobSelect });
  await audit(actor, "hiring.job_created", "JobOpening", job.id, { after: { title: input.title, slug } });
  return serializeJob(job);
}

export async function updateJob(actor: Actor, id: string, input: z.infer<typeof updateJobSchema>) {
  await authorize(actor, "hiring:write");
  const existing = await db.jobOpening.findUnique({ where: { id }, select: { title: true, status: true } });
  if (!existing) throw new NotFoundError("Job");
  if (input.status === "OPEN" && existing.status !== "OPEN" && !can(actor, "hiring:manage")) throw new ForbiddenError("Publishing a job requires hiring:manage");
  const job = await db.jobOpening.update({ where: { id }, data: { ...input }, select: jobSelect });
  await audit(actor, "hiring.job_updated", "JobOpening", id, { before: existing, after: input });
  const counts = await stageCounts([id]);
  return serializeJob(job, counts.get(id));
}

export async function publishJob(actor: Actor, id: string) {
  await authorize(actor, "hiring:manage");
  const j = await db.jobOpening.findUnique({ where: { id }, select: { status: true } });
  if (!j) throw new NotFoundError("Job");
  if (j.status === "CLOSED") throw new ConflictError("Closed jobs cannot be re-published; create a new opening");
  const job = await db.jobOpening.update({ where: { id }, data: { status: "OPEN", isPublic: true, publishedAt: new Date(), closedAt: null }, select: jobSelect });
  await audit(actor, "hiring.job_published", "JobOpening", id);
  return serializeJob(job);
}

export async function closeJob(actor: Actor, id: string) {
  await authorize(actor, "hiring:manage");
  const j = await db.jobOpening.findUnique({ where: { id }, select: { status: true } });
  if (!j) throw new NotFoundError("Job");
  const job = await db.jobOpening.update({ where: { id }, data: { status: "CLOSED", isPublic: false, closedAt: new Date() }, select: jobSelect });
  await audit(actor, "hiring.job_closed", "JobOpening", id);
  return serializeJob(job);
}

export async function listJobs(actor: Actor, input: z.infer<typeof listJobsSchema>) {
  await authorize(actor, "hiring:read");
  const where: Prisma.JobOpeningWhereInput = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.q ? { OR: [{ title: { contains: input.q, mode: "insensitive" } }, { department: { name: { contains: input.q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.jobOpening.findMany({ where, select: jobSelect, orderBy: [{ status: "asc" }, { createdAt: "desc" }], ...paginate(input) }),
    db.jobOpening.count({ where }),
  ]);
  const counts = await stageCounts(rows.map((r) => r.id));
  return toPage(rows.map((r) => serializeJob(r, counts.get(r.id))), total, input);
}

export async function getJob(actor: Actor, id: string) {
  await authorize(actor, "hiring:read");
  const job = await db.jobOpening.findUnique({ where: { id }, select: jobSelect });
  if (!job) throw new NotFoundError("Job");
  const counts = await stageCounts([id]);
  return serializeJob(job, counts.get(id));
}

// ── Candidates ─────────────────────────────────────────────────────────

const candidateSelect = { id: true, firstName: true, lastName: true, email: true, phone: true, resumeKey: true, linkedinUrl: true, currentCompany: true, currentCtc: true, expectedCtc: true, noticePeriodDays: true, source: true, skills: true, createdAt: true } satisfies Prisma.CandidateSelect;

function cleanCandidate<T extends { linkedinUrl?: string | null }>(input: T): T {
  return { ...input, linkedinUrl: input.linkedinUrl || null };
}

/** Create a candidate, or reuse the existing one with the same email (filling in blanks). */
export async function createCandidate(actor: Actor, input: CandidateInput) {
  await authorize(actor, "hiring:write");
  const data = cleanCandidate(input);
  const existing = await db.candidate.findFirst({ where: { email: data.email }, select: candidateSelect, orderBy: { createdAt: "asc" } });
  if (existing) {
    const patch: Prisma.CandidateUpdateInput = {};
    for (const k of ["phone", "linkedinUrl", "currentCompany", "currentCtc", "expectedCtc", "noticePeriodDays"] as const) {
      if (existing[k] == null && data[k] != null) (patch as Record<string, unknown>)[k] = data[k];
    }
    if (data.skills.length && existing.skills.length === 0) patch.skills = data.skills;
    const c = Object.keys(patch).length ? await db.candidate.update({ where: { id: existing.id }, data: patch, select: candidateSelect }) : existing;
    return { ...serializeCandidate(c), reused: true };
  }
  const c = await db.candidate.create({ data: { ...data, source: data.source ?? "MANUAL" }, select: candidateSelect });
  await audit(actor, "hiring.candidate_created", "Candidate", c.id, { after: { email: data.email } });
  return { ...serializeCandidate(c), reused: false };
}

export async function updateCandidate(actor: Actor, id: string, input: z.infer<typeof updateCandidateSchema>) {
  await authorize(actor, "hiring:write");
  const c = await db.candidate.update({ where: { id }, data: cleanCandidate(input), select: candidateSelect }).catch(() => null);
  if (!c) throw new NotFoundError("Candidate");
  await audit(actor, "hiring.candidate_updated", "Candidate", id, { after: input });
  return serializeCandidate(c);
}

export async function listCandidates(actor: Actor, input: z.infer<typeof paginationSchema>) {
  await authorize(actor, "hiring:read");
  const where: Prisma.CandidateWhereInput = input.q
    ? { OR: [{ firstName: { contains: input.q, mode: "insensitive" } }, { lastName: { contains: input.q, mode: "insensitive" } }, { email: { contains: input.q, mode: "insensitive" } }, { currentCompany: { contains: input.q, mode: "insensitive" } }, { skills: { has: input.q } }] }
    : {};
  const [rows, total] = await Promise.all([
    db.candidate.findMany({ where, select: { ...candidateSelect, applications: { select: { id: true, stage: true, job: { select: { id: true, title: true } } }, orderBy: { appliedAt: "desc" }, take: 3 } }, orderBy: { createdAt: "desc" }, ...paginate(input) }),
    db.candidate.count({ where }),
  ]);
  return toPage(rows.map((r) => ({ ...serializeCandidate(r), applications: r.applications.map((a) => ({ id: a.id, stage: a.stage, jobId: a.job.id, jobTitle: a.job.title })) })), total, input);
}

export async function getCandidate(actor: Actor, id: string) {
  await authorize(actor, "hiring:read");
  const c = await db.candidate.findUnique({ where: { id }, select: { ...candidateSelect, applications: { select: { id: true, stage: true, rating: true, appliedAt: true, job: { select: { id: true, title: true, status: true } } }, orderBy: { appliedAt: "desc" } } } });
  if (!c) throw new NotFoundError("Candidate");
  return { ...serializeCandidate(c), resumeUrl: c.resumeKey ? await downloadUrl(c.resumeKey) : null, applications: c.applications.map((a) => ({ ...a, appliedAt: a.appliedAt.toISOString(), jobId: a.job.id, jobTitle: a.job.title, jobStatus: a.job.status, job: undefined })) };
}

async function storeResume(candidateId: string, file: UploadedFile) {
  if (!ALLOWED_MIME.has(file.mimeType)) throw new ValidationError("Resume must be a PDF, DOCX or image");
  const key = makeKey(`resumes/${candidateId}`, file.name || "resume");
  await putFile(key, file.buffer, file.mimeType);
  await db.candidate.update({ where: { id: candidateId }, data: { resumeKey: key } });
  return key;
}

export async function uploadResume(actor: Actor, candidateId: string, file: UploadedFile) {
  await authorize(actor, "hiring:write");
  const c = await db.candidate.findUnique({ where: { id: candidateId }, select: { id: true } });
  if (!c) throw new NotFoundError("Candidate");
  const key = await storeResume(candidateId, file);
  await audit(actor, "hiring.resume_uploaded", "Candidate", candidateId, { after: { key } });
  return { key, url: await downloadUrl(key) };
}

// ── Applications ───────────────────────────────────────────────────────

const applicationSelect = {
  id: true,
  jobId: true,
  job: { select: { id: true, title: true, status: true, openings: true, hiringManagerId: true, recruiterId: true } },
  candidateId: true,
  candidate: { select: candidateSelect },
  stage: true,
  rating: true,
  rejectionReason: true,
  notes: true,
  hiredEmployeeId: true,
  appliedAt: true,
  updatedAt: true,
  interviews: {
    select: { id: true, round: true, title: true, scheduledAt: true, durationMinutes: true, mode: true, meetingLink: true, interviewerIds: true, status: true, feedback: { select: { id: true, interviewerId: true, interviewer: { select: { displayName: true } }, rating: true, recommendation: true, notes: true, createdAt: true } } },
    orderBy: [{ round: "asc" as const }, { scheduledAt: "asc" as const }],
  },
  offer: { select: { id: true, designationId: true, designation: { select: { name: true } }, annualCtc: true, joiningDate: true, status: true, sentAt: true, respondedAt: true, createdAt: true } },
} satisfies Prisma.ApplicationSelect;
type ApplicationRow = Prisma.ApplicationGetPayload<{ select: typeof applicationSelect }>;

async function serializeApplication(a: ApplicationRow) {
  const interviewerIds = [...new Set(a.interviews.flatMap((i) => i.interviewerIds))];
  const interviewers = interviewerIds.length ? await db.employee.findMany({ where: { id: { in: interviewerIds } }, select: { id: true, displayName: true } }) : [];
  const names = new Map(interviewers.map((e) => [e.id, e.displayName]));
  return {
    id: a.id,
    jobId: a.jobId,
    jobTitle: a.job.title,
    jobStatus: a.job.status,
    candidateId: a.candidateId,
    candidate: { ...serializeCandidate(a.candidate), resumeUrl: a.candidate.resumeKey ? await downloadUrl(a.candidate.resumeKey) : null },
    stage: a.stage,
    rating: a.rating,
    rejectionReason: a.rejectionReason,
    notes: a.notes,
    hiredEmployeeId: a.hiredEmployeeId,
    appliedAt: a.appliedAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    interviews: a.interviews.map((i) => ({
      ...i,
      scheduledAt: i.scheduledAt.toISOString(),
      interviewers: i.interviewerIds.map((id) => ({ id, name: names.get(id) ?? "Unknown" })),
      feedback: i.feedback.map((f) => ({ id: f.id, interviewerId: f.interviewerId, interviewerName: f.interviewer.displayName, rating: f.rating, recommendation: f.recommendation, notes: f.notes, createdAt: f.createdAt.toISOString() })),
    })),
    offer: a.offer ? { ...a.offer, designationName: a.offer.designation?.name ?? null, designation: undefined, annualCtc: Number(a.offer.annualCtc), joiningDate: a.offer.joiningDate.toISOString().slice(0, 10), sentAt: a.offer.sentAt?.toISOString() ?? null, respondedAt: a.offer.respondedAt?.toISOString() ?? null, createdAt: a.offer.createdAt.toISOString() } : null,
  };
}
export type ApplicationDto = Awaited<ReturnType<typeof serializeApplication>>;

export async function applyToJob(actor: Actor, input: z.infer<typeof applySchema>) {
  await authorize(actor, "hiring:write");
  const [job, candidate] = await Promise.all([db.jobOpening.findUnique({ where: { id: input.jobId }, select: { status: true } }), db.candidate.findUnique({ where: { id: input.candidateId }, select: { id: true } })]);
  if (!job) throw new NotFoundError("Job");
  if (!candidate) throw new NotFoundError("Candidate");
  if (job.status === "CLOSED") throw new ConflictError("This job is closed");
  const existing = await db.application.findUnique({ where: { jobId_candidateId: input }, select: { id: true } });
  if (existing) throw new ConflictError("This candidate has already applied to this job");
  const a = await db.application.create({ data: { ...input, stage: "APPLIED" }, select: applicationSelect });
  await audit(actor, "hiring.application_created", "Application", a.id, { after: input });
  return serializeApplication(a);
}

export async function getApplication(actor: Actor, id: string) {
  await authorize(actor, "hiring:read");
  const a = await db.application.findUnique({ where: { id }, select: applicationSelect });
  if (!a) throw new NotFoundError("Application");
  return serializeApplication(a);
}

export async function moveStage(actor: Actor, applicationId: string, input: z.infer<typeof moveStageSchema>) {
  await authorize(actor, "hiring:write");
  const a = await db.application.findUnique({ where: { id: applicationId }, select: { stage: true, job: { select: { title: true, hiringManagerId: true, recruiterId: true } }, candidate: { select: { firstName: true, lastName: true } } } });
  if (!a) throw new NotFoundError("Application");
  if (a.stage === "HIRED") throw new ConflictError("Hired applications cannot be moved");
  if (input.stage === a.stage) throw new ConflictError(`Application is already in ${input.stage}`);
  if (input.stage === "OFFER" && !can(actor, "hiring:manage")) throw new ForbiddenError("Moving to OFFER requires hiring:manage");
  const updated = await db.application.update({
    where: { id: applicationId },
    data: { stage: input.stage, rejectionReason: input.stage === "REJECTED" ? (input.rejectionReason ?? null) : null },
    select: applicationSelect,
  });
  await audit(actor, "hiring.stage_changed", "Application", applicationId, { before: { stage: a.stage }, after: { stage: input.stage, rejectionReason: input.rejectionReason } });
  const targets = [a.job.hiringManagerId, a.job.recruiterId].filter((x): x is string => Boolean(x) && x !== actor.employeeId);
  if (targets.length) await notifyMany([...new Set(targets)], { type: "hiring.stage_changed", title: `${a.candidate.firstName} ${a.candidate.lastName} moved to ${input.stage.replace("_", " ")} · ${a.job.title}`, link: `/hiring/jobs/${updated.jobId}?application=${applicationId}` });
  return serializeApplication(updated);
}

export async function rateApplication(actor: Actor, applicationId: string, input: z.infer<typeof rateApplicationSchema>) {
  await authorize(actor, "hiring:write");
  const a = await db.application.update({ where: { id: applicationId }, data: { ...input }, select: applicationSelect }).catch(() => null);
  if (!a) throw new NotFoundError("Application");
  await audit(actor, "hiring.application_rated", "Application", applicationId, { after: input });
  return serializeApplication(a);
}

/** Applications of a job grouped by stage (Kanban). */
export async function pipeline(actor: Actor, jobId: string) {
  await authorize(actor, "hiring:read");
  const job = await db.jobOpening.findUnique({ where: { id: jobId }, select: jobSelect });
  if (!job) throw new NotFoundError("Job");
  const apps = await db.application.findMany({
    where: { jobId },
    select: { id: true, stage: true, rating: true, appliedAt: true, updatedAt: true, rejectionReason: true, candidate: { select: { id: true, firstName: true, lastName: true, email: true, currentCompany: true, expectedCtc: true, source: true, resumeKey: true } }, _count: { select: { interviews: true } }, offer: { select: { status: true } } },
    orderBy: { appliedAt: "desc" },
    take: 1000,
  });
  const columns = PIPELINE_STAGES.map((stage) => ({
    stage,
    items: apps
      .filter((a) => a.stage === stage)
      .map((a) => ({
        id: a.id,
        stage: a.stage,
        rating: a.rating,
        appliedAt: a.appliedAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
        rejectionReason: a.rejectionReason,
        candidateId: a.candidate.id,
        name: `${a.candidate.firstName} ${a.candidate.lastName}`,
        email: a.candidate.email,
        currentCompany: a.candidate.currentCompany,
        expectedCtc: money(a.candidate.expectedCtc),
        source: a.candidate.source,
        hasResume: Boolean(a.candidate.resumeKey),
        interviews: a._count.interviews,
        offerStatus: a.offer?.status ?? null,
      })),
  }));
  const counts = await stageCounts([jobId]);
  return { job: serializeJob(job, counts.get(jobId)), columns, withdrawn: apps.filter((a) => a.stage === "WITHDRAWN").length };
}

// ── Interviews ─────────────────────────────────────────────────────────

export async function scheduleInterview(actor: Actor, applicationId: string, input: z.infer<typeof scheduleInterviewSchema>) {
  await authorize(actor, "hiring:write");
  const a = await db.application.findUnique({ where: { id: applicationId }, select: { stage: true, jobId: true, job: { select: { title: true } }, candidate: { select: { firstName: true, lastName: true } } } });
  if (!a) throw new NotFoundError("Application");
  if (a.stage === "HIRED" || a.stage === "REJECTED" || a.stage === "WITHDRAWN") throw new ConflictError(`Cannot schedule interviews for a ${a.stage.toLowerCase()} application`);
  const interviewerIds = [...new Set(input.interviewerIds)];
  const found = await db.employee.count({ where: { id: { in: interviewerIds }, status: { not: "EXITED" } } });
  if (found !== interviewerIds.length) throw new NotFoundError("One or more interviewers");
  const interview = await db.$transaction(async (tx) => {
    const i = await tx.interview.create({ data: { applicationId, title: input.title, round: input.round, scheduledAt: input.scheduledAt, durationMinutes: input.durationMinutes, mode: input.mode, meetingLink: input.meetingLink || null, interviewerIds } });
    if (a.stage === "APPLIED" || a.stage === "SCREENING") await tx.application.update({ where: { id: applicationId }, data: { stage: "INTERVIEW" } });
    return i;
  });
  await audit(actor, "hiring.interview_scheduled", "Interview", interview.id, { after: { applicationId, title: input.title, scheduledAt: input.scheduledAt, interviewerIds } });
  const when = input.scheduledAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  await notifyMany(interviewerIds, { type: "hiring.interview_scheduled", title: `Interview: ${a.candidate.firstName} ${a.candidate.lastName} · ${a.job.title}`, body: `${input.title} (round ${input.round}) on ${when} IST, ${input.durationMinutes} min, ${input.mode}${input.meetingLink ? ` — ${input.meetingLink}` : ""}`, link: "/hiring/interviews", email: true });
  return { ...interview, scheduledAt: interview.scheduledAt.toISOString(), createdAt: interview.createdAt.toISOString() };
}

/** Interviews where the actor is an interviewer, with their own feedback status. */
export async function listMyInterviews(actor: Actor) {
  const employeeId = requireEmployee(actor);
  await authorize(actor, "hiring:interview");
  const rows = await db.interview.findMany({
    where: { interviewerIds: { has: employeeId } },
    select: { id: true, round: true, title: true, scheduledAt: true, durationMinutes: true, mode: true, meetingLink: true, status: true, interviewerIds: true, application: { select: { id: true, jobId: true, stage: true, job: { select: { title: true } }, candidate: { select: { id: true, firstName: true, lastName: true, currentCompany: true, resumeKey: true } } } }, feedback: { where: { interviewerId: employeeId }, select: { rating: true, recommendation: true, notes: true } } },
    orderBy: { scheduledAt: "desc" },
    take: 100,
  });
  const canSeeResume = can(actor, "hiring:read");
  const now = Date.now();
  return Promise.all(rows.map(async (r) => ({
    id: r.id,
    /** Still to happen (or within the last 3h) and feedback not complete. */
    upcoming: r.scheduledAt.getTime() >= now - 3 * 3600_000 && r.status !== "COMPLETED",
    round: r.round,
    title: r.title,
    scheduledAt: r.scheduledAt.toISOString(),
    durationMinutes: r.durationMinutes,
    mode: r.mode,
    meetingLink: r.meetingLink,
    status: r.status,
    interviewerCount: r.interviewerIds.length,
    applicationId: r.application.id,
    jobId: r.application.jobId,
    jobTitle: r.application.job.title,
    applicationStage: r.application.stage,
    candidateName: `${r.application.candidate.firstName} ${r.application.candidate.lastName}`,
    candidateCompany: r.application.candidate.currentCompany,
    resumeUrl: r.application.candidate.resumeKey ? await downloadUrl(r.application.candidate.resumeKey) : null,
    myFeedback: r.feedback[0] ?? null,
    canSeeResume,
  })));
}

export async function submitInterviewFeedback(actor: Actor, interviewId: string, input: z.infer<typeof interviewFeedbackSchema>) {
  const interviewerId = requireEmployee(actor);
  await authorize(actor, "hiring:interview");
  const i = await db.interview.findUnique({ where: { id: interviewId }, select: { interviewerIds: true, status: true, application: { select: { id: true, jobId: true, job: { select: { title: true, recruiterId: true, hiringManagerId: true } }, candidate: { select: { firstName: true, lastName: true } } } } } });
  if (!i) throw new NotFoundError("Interview");
  if (!i.interviewerIds.includes(interviewerId)) throw new ForbiddenError("Only listed interviewers can submit feedback");
  const fb = await db.$transaction(async (tx) => {
    const f = await tx.interviewFeedback.upsert({ where: { interviewId_interviewerId: { interviewId, interviewerId } }, create: { interviewId, interviewerId, ...input, notes: input.notes ?? null }, update: { ...input, notes: input.notes ?? null } });
    const submitted = await tx.interviewFeedback.count({ where: { interviewId } });
    if (submitted >= i.interviewerIds.length && i.status !== "COMPLETED") await tx.interview.update({ where: { id: interviewId }, data: { status: "COMPLETED" } });
    return f;
  });
  await audit(actor, "hiring.interview_feedback", "InterviewFeedback", fb.id, { after: input });
  const targets = [i.application.job.recruiterId, i.application.job.hiringManagerId].filter((x): x is string => Boolean(x) && x !== interviewerId);
  if (targets.length) await notifyMany([...new Set(targets)], { type: "hiring.interview_feedback", title: `${actor.name} recommended ${input.recommendation.replaceAll("_", " ")} for ${i.application.candidate.firstName} ${i.application.candidate.lastName}`, link: `/hiring/jobs/${i.application.jobId}?application=${i.application.id}` });
  return { ...fb, createdAt: fb.createdAt.toISOString() };
}

// ── Offers ─────────────────────────────────────────────────────────────

function serializeOffer<T extends { annualCtc: Prisma.Decimal; joiningDate: Date; sentAt: Date | null; respondedAt: Date | null; createdAt: Date; updatedAt: Date }>(o: T) {
  return { ...o, annualCtc: Number(o.annualCtc), joiningDate: o.joiningDate.toISOString().slice(0, 10), sentAt: o.sentAt?.toISOString() ?? null, respondedAt: o.respondedAt?.toISOString() ?? null, createdAt: o.createdAt.toISOString(), updatedAt: o.updatedAt.toISOString() };
}

export async function getOffer(actor: Actor, applicationId: string) {
  await authorize(actor, "hiring:read");
  const o = await db.offer.findUnique({ where: { applicationId }, include: { designation: { select: { name: true } } } });
  return o ? { ...serializeOffer(o), designationName: o.designation?.name ?? null, designation: undefined } : null;
}

export async function createOffer(actor: Actor, applicationId: string, input: z.infer<typeof offerSchema>) {
  await authorize(actor, "hiring:manage");
  const a = await db.application.findUnique({ where: { id: applicationId }, select: { stage: true, offer: { select: { id: true, status: true } } } });
  if (!a) throw new NotFoundError("Application");
  if (a.stage === "HIRED" || a.stage === "REJECTED" || a.stage === "WITHDRAWN") throw new ConflictError(`Cannot make an offer to a ${a.stage.toLowerCase()} application`);
  if (a.offer && a.offer.status !== "DRAFT" && a.offer.status !== "DECLINED" && a.offer.status !== "WITHDRAWN") throw new ConflictError(`An offer is already ${a.offer.status.toLowerCase()}`);
  const offer = await db.$transaction(async (tx) => {
    const o = a.offer
      ? await tx.offer.update({ where: { id: a.offer.id }, data: { ...input, status: "DRAFT", sentAt: null, respondedAt: null, approvedById: actor.employeeId } })
      : await tx.offer.create({ data: { applicationId, ...input, approvedById: actor.employeeId } });
    await tx.application.update({ where: { id: applicationId }, data: { stage: "OFFER" } });
    return o;
  });
  await audit(actor, "hiring.offer_created", "Offer", offer.id, { after: { applicationId, annualCtc: input.annualCtc, joiningDate: input.joiningDate } });
  return serializeOffer(offer);
}

export async function sendOffer(actor: Actor, offerId: string) {
  await authorize(actor, "hiring:manage");
  const o = await db.offer.findUnique({ where: { id: offerId }, include: { designation: { select: { name: true } }, application: { select: { job: { select: { title: true } }, candidate: { select: { email: true, firstName: true } } } } } });
  if (!o) throw new NotFoundError("Offer");
  if (o.status !== "DRAFT") throw new ConflictError(`Offer is already ${o.status.toLowerCase()}`);
  const updated = await db.offer.update({ where: { id: offerId }, data: { status: "SENT", sentAt: new Date() } });
  await audit(actor, "hiring.offer_sent", "Offer", offerId);
  const ctc = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(o.annualCtc));
  await sendMail({
    to: o.application.candidate.email,
    subject: `Offer of employment: ${o.application.job.title}`,
    text: `Hi ${o.application.candidate.firstName},\n\nWe are pleased to offer you the position of ${o.designation?.name ?? o.application.job.title}.\n\nAnnual CTC: ${ctc}\nProposed joining date: ${o.joiningDate.toISOString().slice(0, 10)}\n\nPlease reply to this email to accept or decline. We look forward to working with you.\n\nRegards,\n${actor.name}`,
  });
  return serializeOffer(updated);
}

/** Record the candidate's response (recruiters enter it on the candidate's behalf). */
export async function respondOffer(actor: Actor, offerId: string, response: "ACCEPTED" | "DECLINED") {
  await authorize(actor, "hiring:manage");
  const o = await db.offer.findUnique({ where: { id: offerId }, select: { status: true, applicationId: true, application: { select: { jobId: true, job: { select: { title: true, hiringManagerId: true, recruiterId: true } }, candidate: { select: { firstName: true, lastName: true } } } } } });
  if (!o) throw new NotFoundError("Offer");
  if (o.status !== "SENT") throw new ConflictError("Only sent offers can be responded to");
  const updated = await db.offer.update({ where: { id: offerId }, data: { status: response as OfferStatus, respondedAt: new Date() } });
  await audit(actor, "hiring.offer_responded", "Offer", offerId, { before: { status: o.status }, after: { status: response } });
  const targets = [o.application.job.hiringManagerId, o.application.job.recruiterId].filter((x): x is string => Boolean(x) && x !== actor.employeeId);
  if (targets.length) await notifyMany([...new Set(targets)], { type: "hiring.offer_responded", title: `${o.application.candidate.firstName} ${o.application.candidate.lastName} ${response.toLowerCase()} the offer · ${o.application.job.title}`, link: `/hiring/jobs/${o.application.jobId}?application=${o.applicationId}` });
  return serializeOffer(updated);
}

/** Turn an accepted offer into an employee record via the Core HR service. */
export async function convertToEmployee(actor: Actor, applicationId: string, input: z.infer<typeof convertSchema>) {
  await authorize(actor, "hiring:manage");
  const a = await db.application.findUnique({ where: { id: applicationId }, select: { stage: true, jobId: true, hiredEmployeeId: true, candidate: true, offer: true, job: { select: { title: true, openings: true, departmentId: true, locationId: true, hiringManagerId: true, employmentType: true } } } });
  if (!a) throw new NotFoundError("Application");
  if (a.stage === "HIRED" || a.hiredEmployeeId) throw new ConflictError("This application has already been converted");
  if (!a.offer || a.offer.status !== "ACCEPTED") throw new ConflictError("The candidate must accept an offer before conversion");
  // createEmployee accepts hiring:manage (ALL) as an alternative to employees:write for offer conversion.
  const emp = await createEmployee(actor, {
    firstName: a.candidate.firstName,
    lastName: a.candidate.lastName,
    workEmail: input.workEmail,
    personalEmail: a.candidate.email,
    phone: a.candidate.phone ?? undefined,
    joiningDate: a.offer.joiningDate,
    employmentType: a.job.employmentType,
    departmentId: input.departmentId ?? a.job.departmentId ?? undefined,
    designationId: a.offer.designationId ?? undefined,
    locationId: input.locationId ?? a.job.locationId ?? undefined,
    managerId: input.managerId ?? a.job.hiringManagerId ?? undefined,
    annualCtc: Number(a.offer.annualCtc),
    createUser: true,
    sendInvite: true,
  });
  const result = await db.$transaction(async (tx) => {
    await tx.application.update({ where: { id: applicationId }, data: { stage: "HIRED", hiredEmployeeId: emp.id } });
    const hired = await tx.application.count({ where: { jobId: a.jobId, stage: "HIRED" } });
    let jobClosed = false;
    if (hired >= a.job.openings) {
      await tx.jobOpening.update({ where: { id: a.jobId }, data: { status: "CLOSED", isPublic: false, closedAt: new Date() } });
      jobClosed = true;
    }
    return { hired, jobClosed };
  });
  await audit(actor, "hiring.converted_to_employee", "Application", applicationId, { after: { employeeId: emp.id, employeeCode: emp.employeeCode, jobClosed: result.jobClosed } });
  return { applicationId, employeeId: emp.id, employeeCode: emp.employeeCode, userId: emp.userId, jobClosed: result.jobClosed, hiredCount: result.hired };
}

// ── Analytics ──────────────────────────────────────────────────────────

export async function hiringFunnel(actor: Actor) {
  await authorize(actor, "hiring:read");
  const [byStage, jobsByStatus, offers, sources, tth, monthly] = await Promise.all([
    db.application.groupBy({ by: ["stage"], _count: { _all: true } }),
    db.jobOpening.groupBy({ by: ["status"], _count: { _all: true }, _sum: { openings: true } }),
    db.offer.groupBy({ by: ["status"], _count: { _all: true } }),
    db.candidate.groupBy({ by: ["source"], _count: { _all: true }, orderBy: { _count: { source: "desc" } }, take: 10 }),
    db.$queryRaw<{ avgDays: number | null; hired: number }[]>`SELECT AVG(EXTRACT(EPOCH FROM ("updatedAt" - "appliedAt")) / 86400)::float AS "avgDays", COUNT(*)::int AS hired FROM "Application" WHERE stage = 'HIRED'`,
    db.$queryRaw<{ month: string; applied: number; hired: number }[]>`
      SELECT to_char(date_trunc('month', "appliedAt"), 'YYYY-MM') AS month, COUNT(*)::int AS applied, COUNT(*) FILTER (WHERE stage = 'HIRED')::int AS hired
      FROM "Application" WHERE "appliedAt" >= NOW() - INTERVAL '6 months'
      GROUP BY 1 ORDER BY 1`,
  ]);
  const stageCount = Object.fromEntries(byStage.map((s) => [s.stage, s._count._all])) as Partial<Record<ApplicationStage, number>>;
  const offerCount = Object.fromEntries(offers.map((o) => [o.status, o._count._all])) as Partial<Record<OfferStatus, number>>;
  const accepted = offerCount.ACCEPTED ?? 0;
  const declined = offerCount.DECLINED ?? 0;
  const totalApps = byStage.reduce((a, b) => a + b._count._all, 0);
  return {
    totalApplications: totalApps,
    stages: PIPELINE_STAGES.map((stage) => ({ stage, count: stageCount[stage] ?? 0 })),
    jobs: jobsByStatus.map((j) => ({ status: j.status, count: j._count._all, openings: j._sum.openings ?? 0 })),
    offers: { total: offers.reduce((a, b) => a + b._count._all, 0), byStatus: offerCount, acceptanceRate: accepted + declined ? Math.round((accepted / (accepted + declined)) * 100) : null },
    timeToHireDays: tth[0]?.avgDays != null ? Math.round(tth[0].avgDays * 10) / 10 : null,
    hired: tth[0]?.hired ?? 0,
    sources: sources.map((s) => ({ source: s.source ?? "UNKNOWN", count: s._count._all })),
    monthly,
  };
}

// ── Public careers (no actor) ──────────────────────────────────────────

const publicJobSelect = { id: true, title: true, slug: true, employmentType: true, openings: true, description: true, requirements: true, minExperience: true, maxExperience: true, publishedAt: true, department: { select: { name: true } }, location: { select: { name: true, city: true, state: true } } } satisfies Prisma.JobOpeningSelect;

function serializePublicJob(j: Prisma.JobOpeningGetPayload<{ select: typeof publicJobSelect }>) {
  return { id: j.id, title: j.title, slug: j.slug, employmentType: j.employmentType, openings: j.openings, description: j.description, requirements: j.requirements, minExperience: j.minExperience, maxExperience: j.maxExperience, publishedAt: j.publishedAt?.toISOString() ?? null, department: j.department?.name ?? null, location: j.location ? [j.location.name, j.location.city, j.location.state].filter(Boolean).join(", ") : null };
}
export type PublicJobDto = ReturnType<typeof serializePublicJob>;

export async function listPublicJobs() {
  const rows = await db.jobOpening.findMany({ where: { status: "OPEN", isPublic: true }, select: publicJobSelect, orderBy: { publishedAt: "desc" }, take: 200 });
  return rows.map(serializePublicJob);
}

export async function getPublicJob(slug: string) {
  const j = await db.jobOpening.findFirst({ where: { slug, status: "OPEN", isPublic: true }, select: publicJobSelect });
  if (!j) throw new NotFoundError("Job");
  return serializePublicJob(j);
}

export async function publicApply(input: z.infer<typeof publicApplySchema> & { slug: string; resume?: UploadedFile | null }, ip?: string | null) {
  await rateLimit(`careers:${ip ?? "unknown"}`, 10, 60 * 60);
  await rateLimit(`careers-email:${input.email}`, 5, 24 * 60 * 60);
  const job = await db.jobOpening.findFirst({ where: { slug: input.slug, status: "OPEN", isPublic: true }, select: { id: true, title: true, recruiterId: true, hiringManagerId: true } });
  if (!job) throw new NotFoundError("Job");
  const { slug: _slug, resume, ...fields } = input;
  void _slug;
  const data = cleanCandidate(fields);
  let candidate = await db.candidate.findFirst({ where: { email: data.email }, select: { id: true, resumeKey: true }, orderBy: { createdAt: "asc" } });
  if (candidate) {
    await db.candidate.update({ where: { id: candidate.id }, data: { phone: data.phone ?? undefined, linkedinUrl: data.linkedinUrl ?? undefined, currentCompany: data.currentCompany ?? undefined, expectedCtc: data.expectedCtc ?? undefined, noticePeriodDays: data.noticePeriodDays ?? undefined } });
  } else {
    candidate = await db.candidate.create({ data: { ...data, source: "CAREERS" }, select: { id: true, resumeKey: true } });
  }
  const existing = await db.application.findUnique({ where: { jobId_candidateId: { jobId: job.id, candidateId: candidate.id } }, select: { id: true } });
  if (existing) throw new ConflictError("You have already applied for this position");
  if (resume) await storeResume(candidate.id, resume);
  const app = await db.application.create({ data: { jobId: job.id, candidateId: candidate.id, stage: "APPLIED" }, select: { id: true } });
  await audit(null, "hiring.public_application", "Application", app.id, { after: { jobId: job.id, candidateId: candidate.id, email: data.email } });
  const targets = [job.recruiterId, job.hiringManagerId].filter((x): x is string => Boolean(x));
  if (targets.length) await notifyMany([...new Set(targets)], { type: "hiring.new_application", title: `New application: ${data.firstName} ${data.lastName} · ${job.title}`, link: `/hiring/jobs/${job.id}?application=${app.id}` });
  return { applicationId: app.id, candidateId: candidate.id };
}

/** Options for job/offer forms. */
export async function hiringLookups(actor: Actor) {
  await authorize(actor, "hiring:read");
  const [departments, designations, locations] = await Promise.all([
    db.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.designation.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: [{ level: "asc" }, { name: "asc" }] }),
    db.location.findMany({ where: { isActive: true }, select: { id: true, name: true, city: true }, orderBy: { name: "asc" } }),
  ]);
  return { departments, designations, locations: locations.map((l) => ({ id: l.id, name: l.city ? `${l.name} (${l.city})` : l.name })), appUrl: env().APP_URL };
}
