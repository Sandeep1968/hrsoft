import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hmac } from "@/lib/crypto";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { paginate, paginationSchema, toPage, zUuid } from "@/lib/api";
import { type Actor, authorize, can, requireEmployee } from "@/lib/rbac/authorize";
import { Prisma, type QuestionType, type SurveyStatus } from "@/generated/prisma/client";

// ── Schemas ────────────────────────────────────────────────────────────

export const SURVEY_TYPES = ["ENGAGEMENT", "PULSE", "ENPS", "EXIT", "CUSTOM"] as const;
export const QUESTION_TYPES = ["RATING", "NPS", "TEXT", "CHOICE", "MULTI_CHOICE"] as const;

export const announcementSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10000),
  audienceDepartmentIds: z.array(zUuid).max(100).default([]),
  isPinned: z.boolean().default(false),
  expiresAt: z.coerce.date().optional().nullable(),
});
export const updateAnnouncementSchema = announcementSchema.partial();

export const surveyQuestionSchema = z.object({
  text: z.string().trim().min(1).max(500),
  type: z.enum(QUESTION_TYPES).default("RATING"),
  options: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  required: z.boolean().default(true),
});
export const createSurveySchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  type: z.enum(SURVEY_TYPES).default("PULSE"),
  isAnonymous: z.boolean().default(true),
  startsAt: z.coerce.date().optional().nullable(),
  endsAt: z.coerce.date().optional().nullable(),
  targetDepartmentIds: z.array(zUuid).max(100).default([]),
  questions: z.array(surveyQuestionSchema).min(1).max(40),
});
export type CreateSurveyInput = z.infer<typeof createSurveySchema>;
export const updateSurveySchema = createSurveySchema.partial();

export const respondSchema = z.object({ answers: z.record(z.string(), z.union([z.number(), z.string().max(4000), z.array(z.string().max(200)).max(20)])) });
export type SurveyAnswers = z.infer<typeof respondSchema>["answers"];

/** Stored `SurveyResponse.answers` shape: values keyed by question id + the respondent's department (for ≥5 breakdowns). */
interface StoredAnswers {
  values: SurveyAnswers;
  departmentId: string | null;
}

const MIN_DEPT_RESPONSES = 5;

// ── Announcements ──────────────────────────────────────────────────────

const announcementSelect = { id: true, title: true, body: true, authorId: true, author: { select: { displayName: true } }, audienceDepartmentIds: true, isPinned: true, publishedAt: true, expiresAt: true } satisfies Prisma.AnnouncementSelect;

function serializeAnnouncement(a: Prisma.AnnouncementGetPayload<{ select: typeof announcementSelect }>) {
  return { ...a, authorName: a.author?.displayName ?? "HR", author: undefined, publishedAt: a.publishedAt.toISOString(), expiresAt: a.expiresAt?.toISOString() ?? null };
}
export type AnnouncementDto = ReturnType<typeof serializeAnnouncement>;

async function actorDepartmentId(actor: Actor): Promise<string | null> {
  if (!actor.employeeId) return null;
  const e = await db.employee.findUnique({ where: { id: actor.employeeId }, select: { departmentId: true } });
  return e?.departmentId ?? null;
}

export async function createAnnouncement(actor: Actor, input: z.infer<typeof announcementSchema>) {
  await authorize(actor, "engagement:manage");
  const a = await db.announcement.create({ data: { ...input, authorId: actor.employeeId }, select: announcementSelect });
  await audit(actor, "engagement.announcement_created", "Announcement", a.id, { after: { title: input.title } });
  return serializeAnnouncement(a);
}

export async function updateAnnouncement(actor: Actor, id: string, input: z.infer<typeof updateAnnouncementSchema>) {
  await authorize(actor, "engagement:manage");
  const a = await db.announcement.update({ where: { id }, data: input, select: announcementSelect }).catch(() => null);
  if (!a) throw new NotFoundError("Announcement");
  await audit(actor, "engagement.announcement_updated", "Announcement", id, { after: input });
  return serializeAnnouncement(a);
}

export async function deleteAnnouncement(actor: Actor, id: string) {
  await authorize(actor, "engagement:manage");
  await db.announcement.delete({ where: { id } }).catch(() => {
    throw new NotFoundError("Announcement");
  });
  await audit(actor, "engagement.announcement_deleted", "Announcement", id);
}

/** Announcements for the actor's department (or company-wide), pinned first, unexpired. Managers see everything. */
export async function listAnnouncements(actor: Actor, input: z.infer<typeof paginationSchema>) {
  await authorize(actor, "engagement:read");
  const manage = can(actor, "engagement:manage");
  const deptId = manage ? null : await actorDepartmentId(actor);
  const where: Prisma.AnnouncementWhereInput = manage
    ? {}
    : { AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, { OR: [{ audienceDepartmentIds: { isEmpty: true } }, ...(deptId ? [{ audienceDepartmentIds: { has: deptId } }] : [])] }] };
  const [rows, total] = await Promise.all([
    db.announcement.findMany({ where, select: announcementSelect, orderBy: [{ isPinned: "desc" }, { publishedAt: "desc" }], ...paginate(input) }),
    db.announcement.count({ where }),
  ]);
  return toPage(rows.map(serializeAnnouncement), total, input);
}

// ── Surveys ────────────────────────────────────────────────────────────

const surveySelect = {
  id: true,
  title: true,
  description: true,
  type: true,
  isAnonymous: true,
  status: true,
  startsAt: true,
  endsAt: true,
  targetDepartmentIds: true,
  createdById: true,
  createdAt: true,
  questions: { select: { id: true, text: true, type: true, options: true, required: true, order: true }, orderBy: { order: "asc" as const } },
} satisfies Prisma.SurveySelect;
type SurveyRow = Prisma.SurveyGetPayload<{ select: typeof surveySelect }>;

function serializeSurvey(s: SurveyRow) {
  return { ...s, startsAt: s.startsAt?.toISOString() ?? null, endsAt: s.endsAt?.toISOString() ?? null, createdAt: s.createdAt.toISOString() };
}
export type SurveyDto = ReturnType<typeof serializeSurvey>;

function validateQuestions(qs: z.infer<typeof surveyQuestionSchema>[]) {
  for (const q of qs) if ((q.type === "CHOICE" || q.type === "MULTI_CHOICE") && q.options.length < 2) throw new ValidationError(`Question "${q.text}" needs at least two options`);
}

export async function createSurvey(actor: Actor, input: CreateSurveyInput) {
  await authorize(actor, "engagement:manage");
  validateQuestions(input.questions);
  if (input.startsAt && input.endsAt && input.endsAt.getTime() <= input.startsAt.getTime()) throw new ValidationError("endsAt must be after startsAt");
  const { questions, ...rest } = input;
  const s = await db.survey.create({ data: { ...rest, createdById: actor.employeeId, questions: { create: questions.map((q, i) => ({ ...q, order: i })) } }, select: surveySelect });
  await audit(actor, "engagement.survey_created", "Survey", s.id, { after: { title: input.title, type: input.type } });
  return serializeSurvey(s);
}

export async function updateSurvey(actor: Actor, id: string, input: z.infer<typeof updateSurveySchema>) {
  await authorize(actor, "engagement:manage");
  const existing = await db.survey.findUnique({ where: { id }, select: { status: true } });
  if (!existing) throw new NotFoundError("Survey");
  if (existing.status !== "DRAFT") throw new ConflictError("Only draft surveys can be edited");
  if (input.questions) validateQuestions(input.questions);
  const { questions, ...rest } = input;
  const s = await db.$transaction(async (tx) => {
    if (questions) {
      await tx.surveyQuestion.deleteMany({ where: { surveyId: id } });
      await tx.surveyQuestion.createMany({ data: questions.map((q, i) => ({ ...q, surveyId: id, order: i })) });
    }
    return tx.survey.update({ where: { id }, data: rest, select: surveySelect });
  });
  await audit(actor, "engagement.survey_updated", "Survey", id, { after: rest });
  return serializeSurvey(s);
}

const CHUNK = 500;

/** Activate a survey and notify every targeted ACTIVE employee (in batches). */
export async function launchSurvey(actor: Actor, id: string) {
  await authorize(actor, "engagement:manage");
  const s = await db.survey.findUnique({ where: { id }, select: { status: true, title: true, targetDepartmentIds: true, endsAt: true, startsAt: true, _count: { select: { questions: true } } } });
  if (!s) throw new NotFoundError("Survey");
  if (s.status !== "DRAFT") throw new ConflictError("Only draft surveys can be launched");
  if (s._count.questions === 0) throw new ValidationError("Add at least one question before launching");
  await db.survey.update({ where: { id }, data: { status: "ACTIVE", startsAt: s.startsAt ?? new Date() } });
  const where: Prisma.EmployeeWhereInput = { status: "ACTIVE", userId: { not: null }, ...(s.targetDepartmentIds.length ? { departmentId: { in: s.targetDepartmentIds } } : {}) };
  let cursor: string | undefined;
  let notified = 0;
  const link = `/engagement?tab=surveys&survey=${id}`;
  for (;;) {
    const batch = await db.employee.findMany({ where, select: { id: true, userId: true }, orderBy: { id: "asc" }, take: CHUNK, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    if (batch.length === 0) break;
    await db.notification.createMany({ data: batch.map((e) => ({ userId: e.userId!, type: "engagement.survey_launched", title: `New survey: ${s.title}`, body: s.endsAt ? `Please respond by ${s.endsAt.toISOString().slice(0, 10)}.` : "Your feedback takes just a couple of minutes.", link })) });
    notified += batch.length;
    cursor = batch[batch.length - 1].id;
    if (batch.length < CHUNK) break;
  }
  await audit(actor, "engagement.survey_launched", "Survey", id, { after: { notified } });
  return { id, status: "ACTIVE" as const, notified };
}

export async function closeSurvey(actor: Actor, id: string) {
  await authorize(actor, "engagement:manage");
  const s = await db.survey.findUnique({ where: { id }, select: { status: true } });
  if (!s) throw new NotFoundError("Survey");
  if (s.status !== "ACTIVE") throw new ConflictError("Only active surveys can be closed");
  const updated = await db.survey.update({ where: { id }, data: { status: "CLOSED", endsAt: new Date() }, select: surveySelect });
  await audit(actor, "engagement.survey_closed", "Survey", id);
  return serializeSurvey(updated);
}

export async function deleteSurvey(actor: Actor, id: string) {
  await authorize(actor, "engagement:manage");
  const s = await db.survey.findUnique({ where: { id }, select: { status: true } });
  if (!s) throw new NotFoundError("Survey");
  await db.survey.delete({ where: { id } });
  await audit(actor, "engagement.survey_deleted", "Survey", id);
}

function respondentHash(surveyId: string, employeeId: string): string {
  return hmac(`${surveyId}:${employeeId}`);
}

function inWindow(s: { startsAt: Date | null; endsAt: Date | null }, now = new Date()) {
  if (s.startsAt && s.startsAt.getTime() > now.getTime()) return false;
  if (s.endsAt && s.endsAt.getTime() < now.getTime()) return false;
  return true;
}

/** Managers: every survey with response counts. Others: ACTIVE surveys targeted at them, with a `responded` flag. */
export async function listSurveys(actor: Actor) {
  await authorize(actor, "engagement:read");
  if (can(actor, "engagement:manage")) {
    const rows = await db.survey.findMany({ select: { ...surveySelect, _count: { select: { responses: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
    return rows.map((r) => ({ ...serializeSurvey(r), responses: r._count.responses, responded: false }));
  }
  const employeeId = actor.employeeId;
  const deptId = await actorDepartmentId(actor);
  const rows = await db.survey.findMany({
    where: { status: "ACTIVE", OR: [{ targetDepartmentIds: { isEmpty: true } }, ...(deptId ? [{ targetDepartmentIds: { has: deptId } }] : [])] },
    select: surveySelect,
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const hashes = employeeId ? rows.map((r) => respondentHash(r.id, employeeId)) : [];
  const responded = hashes.length ? await db.surveyResponse.findMany({ where: { surveyId: { in: rows.map((r) => r.id) }, respondentHash: { in: hashes } }, select: { surveyId: true } }) : [];
  const done = new Set(responded.map((r) => r.surveyId));
  return rows.filter((r) => inWindow(r)).map((r) => ({ ...serializeSurvey(r), responses: undefined as number | undefined, responded: done.has(r.id) }));
}

export async function getSurveyForRespondent(actor: Actor, id: string) {
  await authorize(actor, "engagement:read");
  const s = await db.survey.findUnique({ where: { id }, select: surveySelect });
  if (!s) throw new NotFoundError("Survey");
  const manage = can(actor, "engagement:manage");
  if (!manage) {
    const deptId = await actorDepartmentId(actor);
    if (s.targetDepartmentIds.length && (!deptId || !s.targetDepartmentIds.includes(deptId))) throw new ForbiddenError("This survey is not addressed to you");
  }
  const responded = actor.employeeId ? Boolean(await db.surveyResponse.findUnique({ where: { surveyId_respondentHash: { surveyId: id, respondentHash: respondentHash(id, actor.employeeId) } }, select: { id: true } })) : false;
  return { ...serializeSurvey(s), responded, open: s.status === "ACTIVE" && inWindow(s) };
}

function validateAnswers(questions: SurveyRow["questions"], answers: SurveyAnswers) {
  for (const q of questions) {
    const v = answers[q.id];
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (empty) {
      if (q.required) throw new ValidationError(`"${q.text}" is required`);
      continue;
    }
    switch (q.type) {
      case "RATING": {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 5) throw new ValidationError(`"${q.text}" must be a rating from 1 to 5`);
        break;
      }
      case "NPS": {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0 || n > 10) throw new ValidationError(`"${q.text}" must be a score from 0 to 10`);
        break;
      }
      case "CHOICE":
        if (typeof v !== "string" || !q.options.includes(v)) throw new ValidationError(`Invalid choice for "${q.text}"`);
        break;
      case "MULTI_CHOICE":
        if (!Array.isArray(v) || v.some((o) => !q.options.includes(o))) throw new ValidationError(`Invalid choices for "${q.text}"`);
        break;
      case "TEXT":
        if (typeof v !== "string") throw new ValidationError(`"${q.text}" must be text`);
        break;
    }
  }
  for (const k of Object.keys(answers)) if (!questions.some((q) => q.id === k)) throw new ValidationError(`Unknown question ${k}`);
}

/** Submit a response; one per respondent (hash of survey + employee + secret). */
export async function respond(actor: Actor, surveyId: string, input: z.infer<typeof respondSchema>) {
  const employeeId = requireEmployee(actor);
  await authorize(actor, "engagement:respond");
  const s = await db.survey.findUnique({ where: { id: surveyId }, select: { ...surveySelect } });
  if (!s) throw new NotFoundError("Survey");
  if (s.status !== "ACTIVE" || !inWindow(s)) throw new ConflictError("This survey is not open for responses");
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { departmentId: true } });
  const deptId = emp?.departmentId ?? null;
  if (s.targetDepartmentIds.length && (!deptId || !s.targetDepartmentIds.includes(deptId))) throw new ForbiddenError("This survey is not addressed to you");
  validateAnswers(s.questions, input.answers);
  const hash = respondentHash(surveyId, employeeId);
  const dup = await db.surveyResponse.findUnique({ where: { surveyId_respondentHash: { surveyId, respondentHash: hash } }, select: { id: true } });
  if (dup) throw new ConflictError("You have already responded to this survey");
  const stored: StoredAnswers = { values: input.answers, departmentId: deptId };
  try {
    const r = await db.surveyResponse.create({ data: { surveyId, employeeId: s.isAnonymous ? null : employeeId, respondentHash: hash, answers: stored as unknown as Prisma.InputJsonValue }, select: { id: true, submittedAt: true } });
    if (!s.isAnonymous) await audit(actor, "engagement.survey_responded", "SurveyResponse", r.id, { after: { surveyId } });
    return { id: r.id, submittedAt: r.submittedAt.toISOString() };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictError("You have already responded to this survey");
    throw e;
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function npsScore(scores: number[]): number | null {
  if (scores.length === 0) return null;
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  return Math.round(((promoters - detractors) / scores.length) * 100);
}

function readStored(json: unknown): StoredAnswers {
  const o = (json ?? {}) as Partial<StoredAnswers>;
  if (o && typeof o === "object" && "values" in o && o.values && typeof o.values === "object") return { values: o.values as SurveyAnswers, departmentId: o.departmentId ?? null };
  return { values: (json ?? {}) as SurveyAnswers, departmentId: null };
}

export interface QuestionResult {
  id: string;
  text: string;
  type: QuestionType;
  answered: number;
  average: number | null;
  distribution: { label: string; count: number }[];
  nps: number | null;
  texts: string[];
}

function aggregateQuestion(q: SurveyRow["questions"][number], values: unknown[], anonymous: boolean): QuestionResult {
  const present = values.filter((v) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0));
  const base: QuestionResult = { id: q.id, text: q.text, type: q.type, answered: present.length, average: null, distribution: [], nps: null, texts: [] };
  if (q.type === "RATING" || q.type === "NPS") {
    const nums = present.map(Number).filter((n) => Number.isFinite(n));
    const max = q.type === "RATING" ? 5 : 10;
    const min = q.type === "RATING" ? 1 : 0;
    const counts = new Map<number, number>();
    for (const n of nums) counts.set(n, (counts.get(n) ?? 0) + 1);
    base.distribution = Array.from({ length: max - min + 1 }, (_, i) => ({ label: String(min + i), count: counts.get(min + i) ?? 0 }));
    base.average = nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null;
    if (q.type === "NPS") base.nps = npsScore(nums);
  } else if (q.type === "CHOICE" || q.type === "MULTI_CHOICE") {
    const counts = new Map<string, number>(q.options.map((o) => [o, 0]));
    for (const v of present) for (const o of Array.isArray(v) ? v : [String(v)]) counts.set(o, (counts.get(o) ?? 0) + 1);
    base.distribution = [...counts.entries()].map(([label, count]) => ({ label, count }));
  } else {
    const texts = present.map(String);
    base.texts = anonymous ? shuffle(texts) : texts;
  }
  return base;
}

async function targetPopulation(targetDepartmentIds: string[]) {
  return db.employee.count({ where: { status: "ACTIVE", ...(targetDepartmentIds.length ? { departmentId: { in: targetDepartmentIds } } : {}) } });
}

/** Aggregated results; department breakdown only where ≥5 responses protect anonymity. */
export async function surveyResults(actor: Actor, id: string) {
  await authorize(actor, "engagement:manage");
  const s = await db.survey.findUnique({ where: { id }, select: surveySelect });
  if (!s) throw new NotFoundError("Survey");
  const [responses, population] = await Promise.all([
    db.surveyResponse.findMany({ where: { surveyId: id }, select: { answers: true, submittedAt: true }, take: 10000 }),
    targetPopulation(s.targetDepartmentIds),
  ]);
  const stored = responses.map((r) => readStored(r.answers));
  const questions = s.questions.map((q) => aggregateQuestion(q, stored.map((r) => r.values[q.id]), s.isAnonymous));
  const npsQuestion = s.questions.find((q) => q.type === "NPS");
  const overallNps = npsQuestion ? (questions.find((q) => q.id === npsQuestion.id)?.nps ?? null) : null;

  const byDept = new Map<string, StoredAnswers[]>();
  for (const r of stored) if (r.departmentId) byDept.set(r.departmentId, [...(byDept.get(r.departmentId) ?? []), r]);
  const eligible = [...byDept.entries()].filter(([, rs]) => rs.length >= MIN_DEPT_RESPONSES);
  const deptNames = eligible.length ? await db.department.findMany({ where: { id: { in: eligible.map(([d]) => d) } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(deptNames.map((d) => [d.id, d.name]));
  const departments = eligible.map(([deptId, rs]) => {
    const ratings = s.questions.filter((q) => q.type === "RATING").flatMap((q) => rs.map((r) => Number(r.values[q.id])).filter((n) => Number.isFinite(n) && n > 0));
    const nps = npsQuestion ? npsScore(rs.map((r) => Number(r.values[npsQuestion.id])).filter((n) => Number.isFinite(n))) : null;
    return { departmentId: deptId, departmentName: nameOf.get(deptId) ?? "Unknown", responses: rs.length, averageRating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100 : null, nps };
  });
  const suppressed = byDept.size - eligible.length;
  const daily = new Map<string, number>();
  for (const r of responses) {
    const d = r.submittedAt.toISOString().slice(0, 10);
    daily.set(d, (daily.get(d) ?? 0) + 1);
  }
  return {
    survey: serializeSurvey(s),
    responses: responses.length,
    population,
    responseRate: population ? Math.round((responses.length / population) * 100) : null,
    nps: overallNps,
    questions,
    departments,
    suppressedDepartments: suppressed,
    timeline: [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
  };
}

/** eNPS trend, participation and praise volume for the engagement dashboard. */
export async function engagementDashboard(actor: Actor) {
  await authorize(actor, "engagement:manage");
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [surveys, praise30, praiseBadges, activeCount] = await Promise.all([
    db.survey.findMany({ where: { status: { in: ["ACTIVE", "CLOSED"] } }, select: { id: true, title: true, type: true, status: true, createdAt: true, startsAt: true, targetDepartmentIds: true, questions: { where: { type: "NPS" }, select: { id: true } }, _count: { select: { responses: true } } }, orderBy: { createdAt: "desc" }, take: 8 }),
    db.feedback.count({ where: { kind: "PRAISE", createdAt: { gte: since } } }),
    db.feedback.groupBy({ by: ["badge"], where: { kind: "PRAISE", createdAt: { gte: since }, badge: { not: null } }, _count: { _all: true }, orderBy: { _count: { badge: "desc" } }, take: 6 }),
    db.employee.count({ where: { status: "ACTIVE" } }),
  ]);
  const trend: { surveyId: string; title: string; date: string; nps: number | null; responses: number; responseRate: number | null; status: SurveyStatus }[] = [];
  for (const s of surveys.reverse()) {
    let nps: number | null = null;
    if (s.questions.length) {
      const rs = await db.surveyResponse.findMany({ where: { surveyId: s.id }, select: { answers: true }, take: 10000 });
      const qid = s.questions[0].id;
      nps = npsScore(rs.map((r) => Number(readStored(r.answers).values[qid])).filter((n) => Number.isFinite(n)));
    }
    const population = s.targetDepartmentIds.length ? await targetPopulation(s.targetDepartmentIds) : activeCount;
    trend.push({ surveyId: s.id, title: s.title, date: (s.startsAt ?? s.createdAt).toISOString().slice(0, 10), nps, responses: s._count.responses, responseRate: population ? Math.round((s._count.responses / population) * 100) : null, status: s.status });
  }
  const withNps = trend.filter((t) => t.nps !== null);
  const rates = trend.filter((t) => t.responseRate !== null);
  return {
    latestNps: withNps.length ? withNps[withNps.length - 1].nps : null,
    previousNps: withNps.length > 1 ? withNps[withNps.length - 2].nps : null,
    participation: rates.length ? Math.round(rates.reduce((a, t) => a + (t.responseRate ?? 0), 0) / rates.length) : null,
    praiseLast30Days: praise30,
    praiseBadges: praiseBadges.map((b) => ({ badge: b.badge ?? "—", count: b._count._all })),
    activeEmployees: activeCount,
    trend,
  };
}

/** Department list for audience pickers. */
export async function engagementLookups(actor: Actor) {
  await authorize(actor, "engagement:read");
  const departments = await db.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return { departments };
}
