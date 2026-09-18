import "server-only";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notify, notifyMany } from "@/lib/notify";
import { addDays, toDateOnly } from "@/lib/dates";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { paginate, paginationSchema, toPage, zDateOnly, zUuid, type Pagination } from "@/lib/api";
import { type Actor, authorize, can, isInTeam, requireEmployee, scopeFilter, teamIds } from "@/lib/rbac/authorize";
import { Prisma, type MetricType, type OkrLevel, type ReviewStatus } from "@/generated/prisma/client";

// ── Constants & schemas ────────────────────────────────────────────────

export const OKR_LEVELS = ["COMPANY", "DEPARTMENT", "TEAM", "INDIVIDUAL"] as const;
export const OKR_STATUSES = ["ON_TRACK", "AT_RISK", "OFF_TRACK", "COMPLETED", "ARCHIVED"] as const;
export const METRIC_TYPES = ["NUMBER", "PERCENT", "CURRENCY", "BOOLEAN"] as const;
const LEVEL_RANK: Record<OkrLevel, number> = { COMPANY: 0, DEPARTMENT: 1, TEAM: 2, INDIVIDUAL: 3 };
const BROAD_LEVELS: OkrLevel[] = ["COMPANY", "DEPARTMENT"];

export const PRAISE_BADGES = ["Team Player", "Customer First", "Ship It", "Problem Solver", "Mentor", "Above & Beyond", "Culture Champion"] as const;

export const keyResultInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  metricType: z.enum(METRIC_TYPES).default("NUMBER"),
  startValue: z.coerce.number().default(0),
  targetValue: z.coerce.number().default(100),
  weight: z.coerce.number().int().min(1).max(10).default(1),
});

export const createObjectiveSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional().nullable(),
  level: z.enum(OKR_LEVELS).default("INDIVIDUAL"),
  periodStart: zDateOnly,
  periodEnd: zDateOnly,
  parentId: zUuid.optional().nullable(),
  ownerId: zUuid.optional().nullable(),
  keyResults: z.array(keyResultInputSchema).max(20).default([]),
});
export type CreateObjectiveInput = z.infer<typeof createObjectiveSchema>;

export const updateObjectiveSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(4000).optional().nullable(),
  periodStart: zDateOnly.optional(),
  periodEnd: zDateOnly.optional(),
  parentId: zUuid.optional().nullable(),
  status: z.enum(OKR_STATUSES).optional(),
});

export const updateKeyResultSchema = z.object({
  value: z.coerce.number(),
  note: z.string().trim().max(1000).optional().nullable(),
});

export const listObjectivesSchema = paginationSchema.extend({
  level: z.enum(OKR_LEVELS).optional(),
  ownerId: zUuid.optional(),
  period: z.string().trim().max(10).optional(),
  status: z.enum(OKR_STATUSES).optional(),
  /** "1" = only objectives owned by the actor's direct/indirect reports. */
  team: z.enum(["1"]).optional(),
});

const questionSchema = z.object({
  id: z.string().trim().min(1).max(40),
  text: z.string().trim().min(1).max(500),
  type: z.enum(["RATING", "TEXT"]).default("TEXT"),
});
export type ReviewQuestion = z.infer<typeof questionSchema>;

export const createCycleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  periodStart: zDateOnly,
  periodEnd: zDateOnly,
  selfReviewDue: zDateOnly,
  managerReviewDue: zDateOnly,
  ratingScale: z.coerce.number().int().min(3).max(10).default(5),
  questions: z.array(questionSchema).min(1).max(30),
  includeDepartmentIds: z.array(zUuid).max(100).default([]),
});
export type CreateCycleInput = z.infer<typeof createCycleSchema>;
export const updateCycleSchema = createCycleSchema.partial();

const answerSchema = z.object({ questionId: z.string().min(1).max(40), value: z.union([z.string().max(4000), z.number()]) });
export const submitReviewSchema = z.object({
  answers: z.array(answerSchema).max(60),
  rating: z.coerce.number().min(0).max(10),
});
export const calibrateSchema = z.object({ finalRating: z.coerce.number().min(0).max(10) });

export const requestFeedbackSchema = z.object({
  subjectId: zUuid,
  providerIds: z.array(zUuid).min(1).max(20),
  cycleId: zUuid.optional().nullable(),
  questions: z.array(questionSchema).max(20).optional(),
  isAnonymous: z.boolean().default(true),
});
export const submitFeedbackSchema = z.object({ answers: z.array(answerSchema).max(40) });

export const givePraiseSchema = z.object({
  toId: zUuid,
  message: z.string().trim().min(1).max(1000),
  badge: z.string().trim().max(60).optional().nullable(),
  kind: z.enum(["PRAISE", "FEEDBACK"]).default("PRAISE"),
  isPublic: z.boolean().default(true),
});
export const listPraiseSchema = paginationSchema.extend({ toId: zUuid.optional() });

export const DEFAULT_FEEDBACK_QUESTIONS: ReviewQuestion[] = [
  { id: "strengths", text: "What does this person do particularly well?", type: "TEXT" },
  { id: "improve", text: "What could this person do differently to be more effective?", type: "TEXT" },
  { id: "collaboration", text: "How effectively does this person collaborate with others?", type: "RATING" },
  { id: "impact", text: "How would you rate this person's overall impact?", type: "RATING" },
];

// ── Helpers ────────────────────────────────────────────────────────────

const num = (d: Prisma.Decimal | number | null | undefined) => (d === null || d === undefined ? null : Number(d));

/** Parse "2026", "2026-Q3" or "2026-H1" into a date range (defaults to the current quarter). */
export function parsePeriod(period?: string | null): { start: Date; end: Date; label: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  const m = period?.match(/^(\d{4})(?:-([QH])([1-4]))?$/i);
  if (!m) return parsePeriod(`${y}-Q${q}`);
  const year = Number(m[1]);
  if (!m[2]) return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year, 11, 31)), label: String(year) };
  const n = Number(m[3]);
  if (m[2].toUpperCase() === "H") {
    if (n > 2) throw new ValidationError("Invalid period");
    const sm = (n - 1) * 6;
    return { start: new Date(Date.UTC(year, sm, 1)), end: new Date(Date.UTC(year, sm + 6, 0)), label: `${year}-H${n}` };
  }
  const sm = (n - 1) * 3;
  return { start: new Date(Date.UTC(year, sm, 1)), end: new Date(Date.UTC(year, sm + 3, 0)), label: `${year}-Q${n}` };
}

/** Progress (0–100) of a single key result. */
export function keyResultProgress(kr: { metricType: MetricType; startValue: number; targetValue: number; currentValue: number }): number {
  if (kr.metricType === "BOOLEAN") return kr.currentValue >= kr.targetValue && kr.currentValue > 0 ? 100 : 0;
  const span = kr.targetValue - kr.startValue;
  if (span === 0) return kr.currentValue >= kr.targetValue ? 100 : 0;
  const raw = ((kr.currentValue - kr.startValue) / span) * 100;
  return Math.max(0, Math.min(100, Math.round(raw * 100) / 100));
}

/** Weighted average of KR progress; null when there are no key results. */
export function objectiveOwnProgress(krs: { metricType: MetricType; startValue: number; targetValue: number; currentValue: number; weight: number }[]): number | null {
  if (krs.length === 0) return null;
  const totalWeight = krs.reduce((s, k) => s + Math.max(1, k.weight), 0);
  const sum = krs.reduce((s, k) => s + keyResultProgress(k) * Math.max(1, k.weight), 0);
  return Math.round((sum / totalWeight) * 100) / 100;
}

/** Objective progress = average of (own KR progress, children objectives' progress). */
export function rollupProgress(own: number | null, children: number[]): number {
  const parts = [...(own === null ? [] : [own]), ...children];
  if (parts.length === 0) return 0;
  return Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100) / 100;
}

async function recomputeObjective(tx: Tx, id: string, depth = 0): Promise<void> {
  if (depth > 12) return;
  const o = await tx.objective.findUnique({
    where: { id },
    select: { parentId: true, keyResults: { select: { metricType: true, startValue: true, targetValue: true, currentValue: true, weight: true } }, children: { select: { progress: true } } },
  });
  if (!o) return;
  const own = objectiveOwnProgress(o.keyResults.map((k) => ({ ...k, startValue: Number(k.startValue), targetValue: Number(k.targetValue), currentValue: Number(k.currentValue) })));
  const progress = rollupProgress(own, o.children.map((c) => Number(c.progress)));
  await tx.objective.update({ where: { id }, data: { progress } });
  if (o.parentId) await recomputeObjective(tx, o.parentId, depth + 1);
}

const objectiveSelect = {
  id: true,
  ownerId: true,
  owner: { select: { displayName: true, department: { select: { id: true, name: true } } } },
  title: true,
  description: true,
  level: true,
  periodStart: true,
  periodEnd: true,
  parentId: true,
  status: true,
  progress: true,
  updatedAt: true,
  keyResults: { select: { id: true, title: true, metricType: true, startValue: true, targetValue: true, currentValue: true, weight: true }, orderBy: { id: "asc" as const } },
  _count: { select: { children: true } },
} satisfies Prisma.ObjectiveSelect;

type ObjectiveRow = Prisma.ObjectiveGetPayload<{ select: typeof objectiveSelect }>;

function serializeObjective(o: ObjectiveRow) {
  return {
    id: o.id,
    ownerId: o.ownerId,
    ownerName: o.owner.displayName,
    departmentId: o.owner.department?.id ?? null,
    departmentName: o.owner.department?.name ?? null,
    title: o.title,
    description: o.description,
    level: o.level,
    periodStart: o.periodStart.toISOString().slice(0, 10),
    periodEnd: o.periodEnd.toISOString().slice(0, 10),
    parentId: o.parentId,
    status: o.status,
    progress: Number(o.progress),
    childCount: o._count.children,
    updatedAt: o.updatedAt.toISOString(),
    keyResults: o.keyResults.map((k) => {
      const kr = { ...k, startValue: Number(k.startValue), targetValue: Number(k.targetValue), currentValue: Number(k.currentValue) };
      return { ...kr, progress: keyResultProgress(kr) };
    }),
  };
}
export type ObjectiveDto = ReturnType<typeof serializeObjective>;

/** Write access for an objective owned by `ownerId` at `level`. */
async function authorizeObjectiveWrite(actor: Actor, level: OkrLevel, ownerId: string) {
  if (can(actor, "performance:manage")) return;
  if (level === "INDIVIDUAL") {
    await authorize(actor, "performance:write", { employeeId: ownerId });
    return;
  }
  if (level === "TEAM") {
    await authorize(actor, "performance:write", { employeeId: ownerId, minScope: "TEAM" });
    return;
  }
  throw new ForbiddenError(`${level} objectives require performance:manage`);
}

/** Where-fragment for objectives the actor may read. */
async function objectiveVisibility(actor: Actor): Promise<Prisma.ObjectiveWhereInput> {
  const scoped = await scopeFilter(actor, "performance:read", "ownerId");
  if (Object.keys(scoped).length === 0) return {};
  return { OR: [{ level: { in: BROAD_LEVELS } }, { level: { in: ["TEAM", "INDIVIDUAL"] }, ...(scoped as Prisma.ObjectiveWhereInput) }] };
}

// ── OKRs ───────────────────────────────────────────────────────────────

export async function listObjectives(actor: Actor, input: z.infer<typeof listObjectivesSchema>) {
  const visibility = await objectiveVisibility(actor);
  const where: Prisma.ObjectiveWhereInput = { AND: [visibility] };
  const and = where.AND as Prisma.ObjectiveWhereInput[];
  if (input.level) and.push({ level: input.level });
  if (input.ownerId) and.push({ ownerId: input.ownerId });
  if (input.team) and.push({ ownerId: { in: [...(await teamIds(actor))] } });
  if (input.status) and.push({ status: input.status });
  if (input.q) and.push({ title: { contains: input.q, mode: "insensitive" } });
  if (input.period) {
    const p = parsePeriod(input.period);
    and.push({ periodStart: { lte: p.end }, periodEnd: { gte: p.start } });
  }
  const [rows, total] = await Promise.all([
    db.objective.findMany({ where, select: objectiveSelect, orderBy: [{ periodStart: "desc" }, { updatedAt: "desc" }], ...paginate(input) }),
    db.objective.count({ where }),
  ]);
  return toPage(rows.map(serializeObjective), total, input);
}

export async function getObjective(actor: Actor, id: string) {
  const o = await db.objective.findFirst({ where: { AND: [{ id }, await objectiveVisibility(actor)] }, select: { ...objectiveSelect, children: { select: objectiveSelect, orderBy: { title: "asc" } }, parent: { select: { id: true, title: true, level: true } } } });
  if (!o) throw new NotFoundError("Objective");
  const updates = await db.keyResultUpdate.findMany({
    where: { keyResult: { objectiveId: id } },
    select: { id: true, keyResultId: true, value: true, note: true, createdAt: true, author: { select: { displayName: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return {
    ...serializeObjective(o),
    parent: o.parent,
    children: o.children.map(serializeObjective),
    updates: updates.map((u) => ({ id: u.id, keyResultId: u.keyResultId, value: Number(u.value), note: u.note, createdAt: u.createdAt.toISOString(), author: u.author.displayName })),
  };
}

export async function createObjective(actor: Actor, input: CreateObjectiveInput) {
  const ownerId = input.ownerId ?? requireEmployee(actor);
  await authorizeObjectiveWrite(actor, input.level, ownerId);
  if (input.periodEnd.getTime() < input.periodStart.getTime()) throw new ValidationError("periodEnd must be after periodStart");
  const owner = await db.employee.findUnique({ where: { id: ownerId }, select: { id: true } });
  if (!owner) throw new NotFoundError("Owner employee");
  if (input.parentId) {
    const parent = await db.objective.findUnique({ where: { id: input.parentId }, select: { level: true } });
    if (!parent) throw new NotFoundError("Parent objective");
    if (LEVEL_RANK[parent.level] > LEVEL_RANK[input.level]) throw new ValidationError("A parent objective must be at the same or a higher level");
  }
  for (const kr of input.keyResults) if (kr.metricType !== "BOOLEAN" && kr.targetValue === kr.startValue) throw new ValidationError(`Key result "${kr.title}" must have a target different from its start value`);
  const created = await db.$transaction(async (tx) => {
    const o = await tx.objective.create({
      data: {
        ownerId,
        title: input.title,
        description: input.description ?? null,
        level: input.level,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        parentId: input.parentId ?? null,
        keyResults: { create: input.keyResults.map((k) => ({ ...k, currentValue: k.metricType === "BOOLEAN" ? 0 : k.startValue })) },
      },
      select: { id: true },
    });
    await recomputeObjective(tx, o.id);
    return tx.objective.findUniqueOrThrow({ where: { id: o.id }, select: objectiveSelect });
  });
  await audit(actor, "performance.objective_created", "Objective", created.id, { after: { title: input.title, level: input.level, ownerId } });
  if (ownerId !== actor.employeeId) await notify({ employeeId: ownerId, type: "performance.objective_assigned", title: `New objective: ${input.title}`, link: "/performance" });
  return serializeObjective(created);
}

export async function updateObjective(actor: Actor, id: string, input: z.infer<typeof updateObjectiveSchema>) {
  const existing = await db.objective.findUnique({ where: { id }, select: objectiveSelect });
  if (!existing) throw new NotFoundError("Objective");
  await authorizeObjectiveWrite(actor, existing.level, existing.ownerId);
  if (input.parentId === id) throw new ValidationError("An objective cannot be its own parent");
  const updated = await db.$transaction(async (tx) => {
    const o = await tx.objective.update({ where: { id }, data: { ...input }, select: objectiveSelect });
    await recomputeObjective(tx, id);
    if (existing.parentId && existing.parentId !== o.parentId) await recomputeObjective(tx, existing.parentId);
    return o;
  });
  await audit(actor, "performance.objective_updated", "Objective", id, { before: { title: existing.title, status: existing.status }, after: input });
  return serializeObjective(updated);
}

export async function setObjectiveStatus(actor: Actor, id: string, status: (typeof OKR_STATUSES)[number]) {
  return updateObjective(actor, id, { status });
}

export async function deleteObjective(actor: Actor, id: string) {
  const existing = await db.objective.findUnique({ where: { id }, select: { id: true, level: true, ownerId: true, parentId: true, title: true } });
  if (!existing) throw new NotFoundError("Objective");
  await authorizeObjectiveWrite(actor, existing.level, existing.ownerId);
  await db.$transaction(async (tx) => {
    await tx.objective.delete({ where: { id } });
    if (existing.parentId) await recomputeObjective(tx, existing.parentId);
  });
  await audit(actor, "performance.objective_deleted", "Objective", id, { before: existing });
}

export async function addKeyResult(actor: Actor, objectiveId: string, input: z.infer<typeof keyResultInputSchema>) {
  const o = await db.objective.findUnique({ where: { id: objectiveId }, select: { level: true, ownerId: true } });
  if (!o) throw new NotFoundError("Objective");
  await authorizeObjectiveWrite(actor, o.level, o.ownerId);
  if (input.metricType !== "BOOLEAN" && input.targetValue === input.startValue) throw new ValidationError("Target must differ from start value");
  const kr = await db.$transaction(async (tx) => {
    const created = await tx.keyResult.create({ data: { objectiveId, ...input, currentValue: input.metricType === "BOOLEAN" ? 0 : input.startValue } });
    await recomputeObjective(tx, objectiveId);
    return created;
  });
  await audit(actor, "performance.key_result_added", "KeyResult", kr.id, { after: input });
  return { ...kr, startValue: Number(kr.startValue), targetValue: Number(kr.targetValue), currentValue: Number(kr.currentValue) };
}

export async function updateKeyResult(actor: Actor, krId: string, input: z.infer<typeof updateKeyResultSchema>) {
  const authorId = requireEmployee(actor);
  const kr = await db.keyResult.findUnique({ where: { id: krId }, select: { id: true, objectiveId: true, currentValue: true, metricType: true, objective: { select: { level: true, ownerId: true, status: true } } } });
  if (!kr) throw new NotFoundError("Key result");
  await authorizeObjectiveWrite(actor, kr.objective.level, kr.objective.ownerId);
  if (kr.objective.status === "ARCHIVED") throw new ConflictError("This objective is archived");
  const value = kr.metricType === "BOOLEAN" ? (input.value > 0 ? 1 : 0) : input.value;
  const result = await db.$transaction(async (tx) => {
    await tx.keyResultUpdate.create({ data: { keyResultId: krId, authorId, value, note: input.note ?? null } });
    await tx.keyResult.update({ where: { id: krId }, data: { currentValue: value } });
    await recomputeObjective(tx, kr.objectiveId);
    return tx.objective.findUniqueOrThrow({ where: { id: kr.objectiveId }, select: objectiveSelect });
  });
  await audit(actor, "performance.key_result_updated", "KeyResult", krId, { before: { value: Number(kr.currentValue) }, after: { value, note: input.note } });
  return serializeObjective(result);
}

export interface OkrTreeNode extends ObjectiveDto {
  children: OkrTreeNode[];
}

/** Nested company → department → team → individual objectives overlapping a period. */
export async function okrTree(actor: Actor, period?: string | null): Promise<{ period: string; roots: OkrTreeNode[] }> {
  const p = parsePeriod(period);
  const where: Prisma.ObjectiveWhereInput = { AND: [await objectiveVisibility(actor), { periodStart: { lte: p.end }, periodEnd: { gte: p.start } }, { status: { not: "ARCHIVED" } }] };
  const rows = await db.objective.findMany({ where, select: objectiveSelect, orderBy: [{ level: "asc" }, { title: "asc" }], take: 2000 });
  const nodes = new Map<string, OkrTreeNode>();
  for (const r of rows) nodes.set(r.id, { ...serializeObjective(r), children: [] });
  const roots: OkrTreeNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.parentId ? nodes.get(n.parentId) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  const sort = (list: OkrTreeNode[]) => {
    list.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.title.localeCompare(b.title));
    list.forEach((c) => sort(c.children));
  };
  sort(roots);
  return { period: p.label, roots };
}

// ── Review cycles ──────────────────────────────────────────────────────

interface CycleMeta {
  items: ReviewQuestion[];
  includeDepartmentIds: string[];
}

/** `ReviewCycle.questions` stores `{ items, includeDepartmentIds }`; tolerate a bare array. */
function cycleMeta(json: unknown): CycleMeta {
  if (Array.isArray(json)) return { items: json as ReviewQuestion[], includeDepartmentIds: [] };
  const o = (json ?? {}) as Partial<CycleMeta>;
  return { items: Array.isArray(o.items) ? o.items : [], includeDepartmentIds: Array.isArray(o.includeDepartmentIds) ? o.includeDepartmentIds : [] };
}

function serializeCycle<T extends { periodStart: Date; periodEnd: Date; selfReviewDue: Date; managerReviewDue: Date; questions: unknown; createdAt: Date }>(c: T) {
  const meta = cycleMeta(c.questions);
  return {
    ...c,
    periodStart: c.periodStart.toISOString().slice(0, 10),
    periodEnd: c.periodEnd.toISOString().slice(0, 10),
    selfReviewDue: c.selfReviewDue.toISOString().slice(0, 10),
    managerReviewDue: c.managerReviewDue.toISOString().slice(0, 10),
    createdAt: c.createdAt.toISOString(),
    questions: meta.items,
    includeDepartmentIds: meta.includeDepartmentIds,
  };
}

export async function createCycle(actor: Actor, input: CreateCycleInput) {
  await authorize(actor, "performance:manage");
  if (input.periodEnd.getTime() < input.periodStart.getTime()) throw new ValidationError("periodEnd must be after periodStart");
  const ids = new Set(input.questions.map((q) => q.id));
  if (ids.size !== input.questions.length) throw new ValidationError("Question ids must be unique");
  const meta: CycleMeta = { items: input.questions, includeDepartmentIds: input.includeDepartmentIds };
  const c = await db.reviewCycle.create({
    data: {
      name: input.name,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      selfReviewDue: input.selfReviewDue,
      managerReviewDue: input.managerReviewDue,
      ratingScale: input.ratingScale,
      questions: meta as unknown as Prisma.InputJsonValue,
    },
  });
  await audit(actor, "performance.cycle_created", "ReviewCycle", c.id, { after: { name: input.name } });
  return serializeCycle(c);
}

export async function updateCycle(actor: Actor, id: string, input: z.infer<typeof updateCycleSchema>) {
  await authorize(actor, "performance:manage");
  const c = await db.reviewCycle.findUnique({ where: { id } });
  if (!c) throw new NotFoundError("Review cycle");
  if (c.status !== "DRAFT" && (input.questions || input.includeDepartmentIds || input.ratingScale)) throw new ConflictError("Questions can only be edited while the cycle is a draft");
  const meta = cycleMeta(c.questions);
  if (input.questions) meta.items = input.questions;
  if (input.includeDepartmentIds) meta.includeDepartmentIds = input.includeDepartmentIds;
  const { questions: _q, includeDepartmentIds: _d, ...rest } = input;
  void _q;
  void _d;
  const updated = await db.reviewCycle.update({ where: { id }, data: { ...rest, questions: meta as unknown as Prisma.InputJsonValue } });
  await audit(actor, "performance.cycle_updated", "ReviewCycle", id, { after: rest });
  return serializeCycle(updated);
}

const CHUNK = 500;

/** Activate a cycle: create one review per eligible ACTIVE employee (joined ≥ 90 days before period end). */
export async function launchCycle(actor: Actor, id: string) {
  await authorize(actor, "performance:manage");
  const c = await db.reviewCycle.findUnique({ where: { id } });
  if (!c) throw new NotFoundError("Review cycle");
  if (c.status !== "DRAFT") throw new ConflictError("Only draft cycles can be launched");
  const meta = cycleMeta(c.questions);
  const cutoff = addDays(toDateOnly(c.periodEnd), -90);
  const where: Prisma.EmployeeWhereInput = {
    status: "ACTIVE",
    joiningDate: { lte: cutoff },
    ...(meta.includeDepartmentIds.length ? { departmentId: { in: meta.includeDepartmentIds } } : {}),
  };
  await db.reviewCycle.update({ where: { id }, data: { status: "ACTIVE" } });
  let cursor: string | undefined;
  let createdCount = 0;
  const managerIds = new Set<string>();
  const link = `/performance?tab=reviews&cycle=${id}`;
  for (;;) {
    const batch = await db.employee.findMany({
      where,
      select: { id: true, managerId: true, userId: true },
      orderBy: { id: "asc" },
      take: CHUNK,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;
    await db.$transaction([
      db.performanceReview.createMany({ data: batch.map((e) => ({ cycleId: id, employeeId: e.id, reviewerId: e.managerId })), skipDuplicates: true }),
      db.notification.createMany({
        data: batch.filter((e) => e.userId).map((e) => ({ userId: e.userId!, type: "performance.cycle_launched", title: `${c.name}: your self-review is open`, body: `Submit your self-review by ${c.selfReviewDue.toISOString().slice(0, 10)}.`, link })),
      }),
    ]);
    for (const e of batch) if (e.managerId) managerIds.add(e.managerId);
    createdCount += batch.length;
    cursor = batch[batch.length - 1].id;
    if (batch.length < CHUNK) break;
  }
  const managers = [...managerIds];
  for (let i = 0; i < managers.length; i += 200) {
    await notifyMany(managers.slice(i, i + 200), { type: "performance.cycle_launched", title: `${c.name}: manager reviews are open`, body: `Complete reviews for your team by ${c.managerReviewDue.toISOString().slice(0, 10)}.`, link });
  }
  await audit(actor, "performance.cycle_launched", "ReviewCycle", id, { after: { reviews: createdCount } });
  return { id, status: "ACTIVE" as const, reviews: createdCount, managers: managers.length };
}

export async function listCycles(actor: Actor) {
  await authorize(actor, "performance:read");
  const manage = can(actor, "performance:manage");
  const rows = await db.reviewCycle.findMany({ orderBy: { periodStart: "desc" }, take: 50 });
  const stats = manage && rows.length ? await db.performanceReview.groupBy({ by: ["cycleId", "status"], where: { cycleId: { in: rows.map((r) => r.id) } }, _count: { _all: true } }) : [];
  return rows.map((r) => {
    const s = stats.filter((x) => x.cycleId === r.id);
    const total = s.reduce((a, b) => a + b._count._all, 0);
    const byStatus = Object.fromEntries(s.map((x) => [x.status, x._count._all])) as Partial<Record<ReviewStatus, number>>;
    return { ...serializeCycle(r), stats: manage ? { total, byStatus } : null };
  });
}

export async function getCycle(actor: Actor, id: string) {
  await authorize(actor, "performance:read");
  const c = await db.reviewCycle.findUnique({ where: { id } });
  if (!c) throw new NotFoundError("Review cycle");
  const grouped = await db.performanceReview.groupBy({ by: ["status"], where: { cycleId: id }, _count: { _all: true } });
  const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) as Partial<Record<ReviewStatus, number>>;
  const total = grouped.reduce((a, g) => a + g._count._all, 0);
  const done = (byStatus.SELF_SUBMITTED ?? 0) + (byStatus.MANAGER_SUBMITTED ?? 0) + (byStatus.CALIBRATED ?? 0) + (byStatus.SHARED ?? 0);
  const managerDone = (byStatus.MANAGER_SUBMITTED ?? 0) + (byStatus.CALIBRATED ?? 0) + (byStatus.SHARED ?? 0);
  return { ...serializeCycle(c), stats: { total, byStatus, selfCompletion: total ? Math.round((done / total) * 100) : 0, managerCompletion: total ? Math.round((managerDone / total) * 100) : 0 } };
}

export async function moveToCalibration(actor: Actor, id: string) {
  await authorize(actor, "performance:manage");
  const c = await db.reviewCycle.findUnique({ where: { id }, select: { status: true } });
  if (!c) throw new NotFoundError("Review cycle");
  if (c.status !== "ACTIVE") throw new ConflictError("Only active cycles can move to calibration");
  const updated = await db.reviewCycle.update({ where: { id }, data: { status: "CALIBRATION" } });
  await audit(actor, "performance.cycle_calibration", "ReviewCycle", id);
  return serializeCycle(updated);
}

/** Complete a cycle: every review becomes SHARED and employees are notified. */
export async function completeCycle(actor: Actor, id: string) {
  await authorize(actor, "performance:manage");
  const c = await db.reviewCycle.findUnique({ where: { id }, select: { status: true, name: true } });
  if (!c) throw new NotFoundError("Review cycle");
  if (c.status !== "CALIBRATION" && c.status !== "ACTIVE") throw new ConflictError("This cycle is already completed");
  const now = new Date();
  await db.$transaction([
    db.reviewCycle.update({ where: { id }, data: { status: "COMPLETED" } }),
    db.performanceReview.updateMany({ where: { cycleId: id }, data: { status: "SHARED", sharedAt: now } }),
  ]);
  let cursor: string | undefined;
  const link = `/performance?tab=reviews&cycle=${id}`;
  for (;;) {
    const batch = await db.performanceReview.findMany({ where: { cycleId: id }, select: { id: true, employee: { select: { userId: true } } }, orderBy: { id: "asc" }, take: CHUNK, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    if (batch.length === 0) break;
    await db.notification.createMany({ data: batch.filter((r) => r.employee.userId).map((r) => ({ userId: r.employee.userId!, type: "performance.review_shared", title: `${c.name}: your review results are available`, link })) });
    cursor = batch[batch.length - 1].id;
    if (batch.length < CHUNK) break;
  }
  await audit(actor, "performance.cycle_completed", "ReviewCycle", id);
  return getCycle(actor, id);
}

export async function deleteCycle(actor: Actor, id: string) {
  await authorize(actor, "performance:manage");
  const c = await db.reviewCycle.findUnique({ where: { id }, select: { status: true } });
  if (!c) throw new NotFoundError("Review cycle");
  if (c.status === "COMPLETED") throw new ConflictError("Completed cycles cannot be deleted");
  await db.reviewCycle.delete({ where: { id } });
  await audit(actor, "performance.cycle_deleted", "ReviewCycle", id);
}

// ── Reviews ────────────────────────────────────────────────────────────

const reviewSelect = {
  id: true,
  cycleId: true,
  employeeId: true,
  employee: { select: { displayName: true, employeeCode: true, department: { select: { id: true, name: true } }, designation: { select: { name: true } } } },
  reviewerId: true,
  reviewer: { select: { displayName: true } },
  selfAnswers: true,
  selfRating: true,
  selfSubmittedAt: true,
  managerAnswers: true,
  managerRating: true,
  managerSubmittedAt: true,
  finalRating: true,
  status: true,
  sharedAt: true,
  updatedAt: true,
} satisfies Prisma.PerformanceReviewSelect;
type ReviewRow = Prisma.PerformanceReviewGetPayload<{ select: typeof reviewSelect }>;

function serializeReview(r: ReviewRow, opts: { hideManager?: boolean } = {}) {
  const shared = r.status === "SHARED";
  const hide = opts.hideManager && !shared;
  return {
    id: r.id,
    cycleId: r.cycleId,
    employeeId: r.employeeId,
    employeeName: r.employee.displayName,
    employeeCode: r.employee.employeeCode,
    departmentId: r.employee.department?.id ?? null,
    departmentName: r.employee.department?.name ?? null,
    designation: r.employee.designation?.name ?? null,
    reviewerId: r.reviewerId,
    reviewerName: r.reviewer?.displayName ?? null,
    selfAnswers: (r.selfAnswers as { questionId: string; value: string | number }[] | null) ?? null,
    selfRating: num(r.selfRating),
    selfSubmittedAt: r.selfSubmittedAt?.toISOString() ?? null,
    managerAnswers: hide ? null : ((r.managerAnswers as { questionId: string; value: string | number }[] | null) ?? null),
    managerRating: hide ? null : num(r.managerRating),
    managerSubmittedAt: r.managerSubmittedAt?.toISOString() ?? null,
    finalRating: hide ? null : num(r.finalRating),
    status: r.status,
    sharedAt: r.sharedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
  };
}
export type ReviewDto = ReturnType<typeof serializeReview>;

function validateAnswers(questions: ReviewQuestion[], answers: { questionId: string; value: string | number }[], scale: number) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const a of answers) {
    const q = byId.get(a.questionId);
    if (!q) throw new ValidationError(`Unknown question ${a.questionId}`);
    if (q.type === "RATING") {
      const v = Number(a.value);
      if (!Number.isFinite(v) || v < 1 || v > scale) throw new ValidationError(`Rating for "${q.text}" must be between 1 and ${scale}`);
    }
  }
}

/** The actor's own review in a cycle (latest non-draft cycle when `cycleId` is omitted). */
export async function getMyReview(actor: Actor, cycleId?: string | null) {
  const employeeId = requireEmployee(actor);
  await authorize(actor, "performance:read", { employeeId });
  const r = await db.performanceReview.findFirst({
    where: { employeeId, ...(cycleId ? { cycleId } : { cycle: { status: { not: "DRAFT" } } }) },
    select: { ...reviewSelect, cycle: true },
    orderBy: { cycle: { periodStart: "desc" } },
  });
  if (!r) return null;
  const { cycle, ...rest } = r;
  return { ...serializeReview(rest, { hideManager: true }), cycle: serializeCycle(cycle) };
}

export async function submitSelfReview(actor: Actor, reviewId: string, input: z.infer<typeof submitReviewSchema>) {
  const r = await db.performanceReview.findUnique({ where: { id: reviewId }, select: { employeeId: true, status: true, cycle: true } });
  if (!r) throw new NotFoundError("Review");
  await authorize(actor, "performance:write", { employeeId: r.employeeId });
  if (actor.employeeId !== r.employeeId && !can(actor, "performance:manage")) throw new ForbiddenError("Only the employee can submit their self-review");
  if (r.cycle.status !== "ACTIVE") throw new ConflictError("This review cycle is not active");
  if (r.status !== "NOT_STARTED") throw new ConflictError("Self-review has already been submitted");
  if (input.rating < 1 || input.rating > r.cycle.ratingScale) throw new ValidationError(`Rating must be between 1 and ${r.cycle.ratingScale}`);
  validateAnswers(cycleMeta(r.cycle.questions).items, input.answers, r.cycle.ratingScale);
  const updated = await db.performanceReview.update({
    where: { id: reviewId },
    data: { selfAnswers: input.answers as Prisma.InputJsonValue, selfRating: input.rating, selfSubmittedAt: new Date(), status: "SELF_SUBMITTED" },
    select: { ...reviewSelect, reviewerId: true },
  });
  await audit(actor, "performance.self_review_submitted", "PerformanceReview", reviewId);
  if (updated.reviewerId) await notify({ employeeId: updated.reviewerId, type: "performance.self_review_submitted", title: `${updated.employee.displayName} submitted their self-review`, link: `/performance?tab=reviews&cycle=${updated.cycleId}` });
  return serializeReview(updated, { hideManager: true });
}

export async function submitManagerReview(actor: Actor, reviewId: string, input: z.infer<typeof submitReviewSchema>) {
  const r = await db.performanceReview.findUnique({ where: { id: reviewId }, select: { employeeId: true, reviewerId: true, status: true, cycle: true } });
  if (!r) throw new NotFoundError("Review");
  if (!can(actor, "performance:manage")) await authorize(actor, "performance:review", { employeeId: r.employeeId });
  if (r.employeeId === actor.employeeId) throw new ForbiddenError("You cannot write your own manager review");
  if (r.cycle.status !== "ACTIVE" && r.cycle.status !== "CALIBRATION") throw new ConflictError("This review cycle is not accepting manager reviews");
  if (r.status !== "NOT_STARTED" && r.status !== "SELF_SUBMITTED") throw new ConflictError("Manager review has already been submitted");
  if (input.rating < 1 || input.rating > r.cycle.ratingScale) throw new ValidationError(`Rating must be between 1 and ${r.cycle.ratingScale}`);
  validateAnswers(cycleMeta(r.cycle.questions).items, input.answers, r.cycle.ratingScale);
  const updated = await db.performanceReview.update({
    where: { id: reviewId },
    data: { managerAnswers: input.answers as Prisma.InputJsonValue, managerRating: input.rating, managerSubmittedAt: new Date(), status: "MANAGER_SUBMITTED", reviewerId: r.reviewerId ?? actor.employeeId ?? undefined },
    select: reviewSelect,
  });
  await audit(actor, "performance.manager_review_submitted", "PerformanceReview", reviewId, { after: { rating: input.rating } });
  return serializeReview(updated);
}

export const listTeamReviewsSchema = paginationSchema.extend({ departmentId: zUuid.optional(), status: z.enum(["NOT_STARTED", "SELF_SUBMITTED", "MANAGER_SUBMITTED", "CALIBRATED", "SHARED"]).optional() });

/** Reviews the actor manages in a cycle: everything for ALL scope, otherwise their reports / reviewer assignments. */
export async function listTeamReviews(actor: Actor, cycleId: string, input: z.infer<typeof listTeamReviewsSchema>) {
  const scope = can(actor, "performance:manage") ? "ALL" : await authorize(actor, "performance:review");
  const where: Prisma.PerformanceReviewWhereInput = { cycleId };
  if (scope !== "ALL") {
    const ids = [...(await teamIds(actor))];
    where.OR = [{ reviewerId: actor.employeeId ?? "00000000-0000-0000-0000-000000000000" }, { employeeId: { in: ids } }];
    where.NOT = { employeeId: actor.employeeId ?? undefined };
  }
  if (input.departmentId) where.employee = { departmentId: input.departmentId };
  if (input.status) where.status = input.status;
  if (input.q) where.employee = { ...(where.employee as Prisma.EmployeeWhereInput), displayName: { contains: input.q, mode: "insensitive" } };
  const [rows, total] = await Promise.all([
    db.performanceReview.findMany({ where, select: reviewSelect, orderBy: [{ employee: { displayName: "asc" } }], ...paginate(input) }),
    db.performanceReview.count({ where }),
  ]);
  return toPage(rows.map((r) => serializeReview(r)), total, input);
}

export async function getReview(actor: Actor, reviewId: string) {
  const r = await db.performanceReview.findUnique({ where: { id: reviewId }, select: { ...reviewSelect, cycle: true } });
  if (!r) throw new NotFoundError("Review");
  const self = r.employeeId === actor.employeeId;
  if (!self && !can(actor, "performance:manage")) await authorize(actor, "performance:review", { employeeId: r.employeeId });
  const { cycle, ...rest } = r;
  return { ...serializeReview(rest, { hideManager: self }), cycle: serializeCycle(cycle) };
}

export async function calibrate(actor: Actor, reviewId: string, finalRating: number) {
  await authorize(actor, "performance:manage");
  const r = await db.performanceReview.findUnique({ where: { id: reviewId }, select: { status: true, finalRating: true, cycle: { select: { status: true, ratingScale: true } } } });
  if (!r) throw new NotFoundError("Review");
  if (r.cycle.status !== "CALIBRATION" && r.cycle.status !== "ACTIVE") throw new ConflictError("Calibration is closed for this cycle");
  if (finalRating < 1 || finalRating > r.cycle.ratingScale) throw new ValidationError(`Rating must be between 1 and ${r.cycle.ratingScale}`);
  const updated = await db.performanceReview.update({ where: { id: reviewId }, data: { finalRating, calibratedById: actor.employeeId ?? null, status: "CALIBRATED" }, select: reviewSelect });
  await audit(actor, "performance.review_calibrated", "PerformanceReview", reviewId, { before: { finalRating: num(r.finalRating) }, after: { finalRating } });
  return serializeReview(updated);
}

export interface CalibrationGrid {
  scale: number;
  total: number;
  byRating: { rating: number; count: number }[];
  byDepartment: { departmentId: string | null; departmentName: string; total: number; avg: number | null; counts: Record<number, number> }[];
  unrated: number;
}

/** Distribution of (final ?? manager) ratings overall and per department. */
export async function calibrationGrid(actor: Actor, cycleId: string): Promise<CalibrationGrid> {
  await authorize(actor, "performance:manage");
  const c = await db.reviewCycle.findUnique({ where: { id: cycleId }, select: { ratingScale: true } });
  if (!c) throw new NotFoundError("Review cycle");
  const rows = await db.$queryRaw<{ departmentId: string | null; departmentName: string | null; rating: number | null; count: number; sum: number | null }[]>`
    SELECT d.id AS "departmentId", d.name AS "departmentName",
           ROUND(COALESCE(r."finalRating", r."managerRating"))::int AS rating,
           COUNT(*)::int AS count,
           SUM(COALESCE(r."finalRating", r."managerRating"))::float AS sum
    FROM "PerformanceReview" r
    JOIN "Employee" e ON e.id = r."employeeId"
    LEFT JOIN "Department" d ON d.id = e."departmentId"
    WHERE r."cycleId" = ${cycleId}::uuid
    GROUP BY d.id, d.name, rating
    ORDER BY d.name NULLS LAST, rating`;
  const byRatingMap = new Map<number, number>();
  const depts = new Map<string, CalibrationGrid["byDepartment"][number] & { _sum: number; _rated: number }>();
  let unrated = 0;
  let total = 0;
  for (const r of rows) {
    total += r.count;
    if (r.rating === null) unrated += r.count;
    else byRatingMap.set(r.rating, (byRatingMap.get(r.rating) ?? 0) + r.count);
    const key = r.departmentId ?? "none";
    const d = depts.get(key) ?? { departmentId: r.departmentId, departmentName: r.departmentName ?? "No department", total: 0, avg: null, counts: {}, _sum: 0, _rated: 0 };
    d.total += r.count;
    if (r.rating !== null) {
      d.counts[r.rating] = (d.counts[r.rating] ?? 0) + r.count;
      d._sum += r.sum ?? 0;
      d._rated += r.count;
    }
    depts.set(key, d);
  }
  const byRating = Array.from({ length: c.ratingScale }, (_, i) => ({ rating: i + 1, count: byRatingMap.get(i + 1) ?? 0 }));
  const byDepartment = [...depts.values()].map(({ _sum, _rated, ...d }) => ({ ...d, avg: _rated ? Math.round((_sum / _rated) * 100) / 100 : null })).sort((a, b) => a.departmentName.localeCompare(b.departmentName));
  return { scale: c.ratingScale, total, byRating, byDepartment, unrated };
}

// ── 360° feedback ──────────────────────────────────────────────────────

async function canSeeFeedbackAbout(actor: Actor, subjectId: string): Promise<boolean> {
  if (can(actor, "performance:manage")) return true;
  if (can(actor, "performance:review", "TEAM") && actor.employeeId !== subjectId && (await isInTeam(actor, subjectId))) return true;
  return false;
}

export async function requestFeedback(actor: Actor, input: z.infer<typeof requestFeedbackSchema>) {
  const self = actor.employeeId === input.subjectId;
  if (self) await authorize(actor, "performance:write", { employeeId: input.subjectId });
  else if (!(await canSeeFeedbackAbout(actor, input.subjectId))) throw new ForbiddenError("Only the employee, their manager or HR can request feedback");
  const providerIds = [...new Set(input.providerIds)].filter((p) => p !== input.subjectId);
  if (providerIds.length === 0) throw new ValidationError("Choose at least one provider other than the subject");
  const providers = await db.employee.findMany({ where: { id: { in: providerIds }, status: { not: "EXITED" } }, select: { id: true } });
  if (providers.length !== providerIds.length) throw new NotFoundError("One or more providers");
  const subject = await db.employee.findUnique({ where: { id: input.subjectId }, select: { displayName: true } });
  if (!subject) throw new NotFoundError("Subject employee");
  if (input.cycleId) {
    const cyc = await db.reviewCycle.findUnique({ where: { id: input.cycleId }, select: { id: true } });
    if (!cyc) throw new NotFoundError("Review cycle");
  }
  const questions = (input.questions?.length ? input.questions : DEFAULT_FEEDBACK_QUESTIONS) as unknown as Prisma.InputJsonValue;
  const existing = await db.feedbackRequest.findMany({ where: { subjectId: input.subjectId, providerId: { in: providerIds }, status: "PENDING", cycleId: input.cycleId ?? null }, select: { providerId: true } });
  const skip = new Set(existing.map((e) => e.providerId));
  const toCreate = providerIds.filter((p) => !skip.has(p));
  await db.feedbackRequest.createMany({ data: toCreate.map((providerId) => ({ subjectId: input.subjectId, providerId, cycleId: input.cycleId ?? null, requestedById: actor.employeeId, questions, isAnonymous: input.isAnonymous })) });
  await audit(actor, "performance.feedback_requested", "FeedbackRequest", null, { after: { subjectId: input.subjectId, providerIds: toCreate } });
  await notifyMany(toCreate, { type: "performance.feedback_requested", title: `Feedback requested about ${subject.displayName}`, body: `${actor.name} asked for your feedback.`, link: "/performance?tab=feedback" });
  return { created: toCreate.length, skipped: skip.size };
}

export async function listMyFeedbackRequests(actor: Actor) {
  const providerId = requireEmployee(actor);
  const rows = await db.feedbackRequest.findMany({
    where: { providerId },
    select: { id: true, subjectId: true, subject: { select: { displayName: true, designation: { select: { name: true } } } }, cycleId: true, cycle: { select: { name: true } }, questions: true, status: true, isAnonymous: true, submittedAt: true, createdAt: true },
    orderBy: [{ status: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  return rows.map((r) => ({ ...r, subjectName: r.subject.displayName, subjectDesignation: r.subject.designation?.name ?? null, cycleName: r.cycle?.name ?? null, questions: r.questions as ReviewQuestion[], submittedAt: r.submittedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(), subject: undefined, cycle: undefined }));
}

/** Requests the actor raised or that are about them (status only — never the answers). */
export async function listFeedbackRequestsAboutMe(actor: Actor) {
  const subjectId = requireEmployee(actor);
  const rows = await db.feedbackRequest.findMany({ where: { subjectId }, select: { id: true, providerId: true, provider: { select: { displayName: true } }, status: true, isAnonymous: true, createdAt: true, submittedAt: true }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((r) => ({ id: r.id, providerId: r.providerId, providerName: r.provider.displayName, status: r.status, isAnonymous: r.isAnonymous, createdAt: r.createdAt.toISOString(), submittedAt: r.submittedAt?.toISOString() ?? null }));
}

export async function submitFeedback(actor: Actor, requestId: string, input: z.infer<typeof submitFeedbackSchema>) {
  const providerId = requireEmployee(actor);
  const r = await db.feedbackRequest.findUnique({ where: { id: requestId }, select: { providerId: true, status: true, questions: true, subjectId: true, subject: { select: { displayName: true } }, requestedById: true } });
  if (!r) throw new NotFoundError("Feedback request");
  if (r.providerId !== providerId) throw new ForbiddenError("This feedback request is not addressed to you");
  if (r.status !== "PENDING") throw new ConflictError("Feedback has already been submitted");
  validateAnswers(r.questions as ReviewQuestion[], input.answers, 5);
  const updated = await db.feedbackRequest.update({ where: { id: requestId }, data: { answers: input.answers as Prisma.InputJsonValue, status: "SUBMITTED", submittedAt: new Date() }, select: { id: true, status: true, submittedAt: true } });
  await audit(actor, "performance.feedback_submitted", "FeedbackRequest", requestId);
  if (r.requestedById && r.requestedById !== providerId) await notify({ employeeId: r.requestedById, type: "performance.feedback_received", title: `New 360° feedback received about ${r.subject.displayName}`, link: "/performance?tab=feedback" });
  return { ...updated, submittedAt: updated.submittedAt?.toISOString() ?? null };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Aggregated 360° feedback for a subject (anonymised for anonymous requests). */
export async function feedbackSummaryForSubject(actor: Actor, subjectId: string, cycleId?: string | null) {
  if (!(await canSeeFeedbackAbout(actor, subjectId))) throw new ForbiddenError("Only the employee's manager or HR can view feedback summaries");
  const rows = await db.feedbackRequest.findMany({
    where: { subjectId, ...(cycleId ? { cycleId } : {}) },
    select: { id: true, status: true, isAnonymous: true, questions: true, answers: true, provider: { select: { displayName: true } }, submittedAt: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const submitted = rows.filter((r) => r.status === "SUBMITTED" && Array.isArray(r.answers));
  const questions = new Map<string, { id: string; text: string; type: "RATING" | "TEXT"; ratings: number[]; texts: { text: string; from: string | null }[] }>();
  for (const r of submitted) {
    const qs = r.questions as ReviewQuestion[];
    for (const q of qs) if (!questions.has(q.id)) questions.set(q.id, { id: q.id, text: q.text, type: q.type, ratings: [], texts: [] });
    for (const a of r.answers as { questionId: string; value: string | number }[]) {
      const q = questions.get(a.questionId);
      if (!q) continue;
      if (q.type === "RATING") q.ratings.push(Number(a.value));
      else if (String(a.value).trim()) q.texts.push({ text: String(a.value), from: r.isAnonymous ? null : r.provider.displayName });
    }
  }
  const anyAnonymous = submitted.some((r) => r.isAnonymous);
  return {
    subjectId,
    requested: rows.length,
    submitted: submitted.length,
    providers: anyAnonymous ? null : submitted.map((r) => r.provider.displayName),
    questions: [...questions.values()].map((q) => ({
      id: q.id,
      text: q.text,
      type: q.type,
      average: q.ratings.length ? Math.round((q.ratings.reduce((a, b) => a + b, 0) / q.ratings.length) * 100) / 100 : null,
      count: q.type === "RATING" ? q.ratings.length : q.texts.length,
      texts: anyAnonymous ? shuffle(q.texts).map((t) => ({ text: t.text, from: null })) : q.texts,
    })),
  };
}

// ── Praise wall ────────────────────────────────────────────────────────

const praiseSelect = {
  id: true,
  kind: true,
  fromId: true,
  from: { select: { displayName: true, designation: { select: { name: true } } } },
  toId: true,
  to: { select: { displayName: true, designation: { select: { name: true } } } },
  message: true,
  badge: true,
  isPublic: true,
  createdAt: true,
} satisfies Prisma.FeedbackSelect;

function serializePraise(p: Prisma.FeedbackGetPayload<{ select: typeof praiseSelect }>) {
  return { id: p.id, kind: p.kind, fromId: p.fromId, fromName: p.from.displayName, fromDesignation: p.from.designation?.name ?? null, toId: p.toId, toName: p.to.displayName, toDesignation: p.to.designation?.name ?? null, message: p.message, badge: p.badge, isPublic: p.isPublic, createdAt: p.createdAt.toISOString() };
}
export type PraiseDto = ReturnType<typeof serializePraise>;

export async function givePraise(actor: Actor, input: z.infer<typeof givePraiseSchema>) {
  const fromId = requireEmployee(actor);
  await authorize(actor, "performance:write");
  if (input.toId === fromId) throw new ValidationError("You cannot praise yourself");
  const to = await db.employee.findUnique({ where: { id: input.toId }, select: { displayName: true, status: true } });
  if (!to || to.status === "EXITED") throw new NotFoundError("Recipient");
  const isPublic = input.kind === "FEEDBACK" ? false : input.isPublic;
  const p = await db.feedback.create({ data: { kind: input.kind, fromId, toId: input.toId, message: input.message, badge: input.badge ?? null, isPublic }, select: praiseSelect });
  await audit(actor, "performance.praise_given", "Feedback", p.id, { after: { toId: input.toId, kind: input.kind, badge: input.badge } });
  await notify({ employeeId: input.toId, type: input.kind === "PRAISE" ? "performance.praise" : "performance.feedback", title: input.kind === "PRAISE" ? `${actor.name} gave you praise${input.badge ? ` · ${input.badge}` : ""}` : `${actor.name} shared private feedback with you`, body: input.message.slice(0, 200), link: "/performance?tab=praise" });
  return serializePraise(p);
}

/** Public praise wall plus anything sent to or by the actor (private feedback about reports is visible to their manager). */
export async function listPraise(actor: Actor, input: z.infer<typeof listPraiseSchema>) {
  await authorize(actor, "performance:read");
  const me = actor.employeeId;
  const or: Prisma.FeedbackWhereInput[] = [{ kind: "PRAISE", isPublic: true }];
  if (me) {
    or.push({ toId: me }, { fromId: me });
    if (can(actor, "performance:review", "TEAM")) or.push({ kind: "FEEDBACK", toId: { in: [...(await teamIds(actor))] } });
  }
  if (can(actor, "performance:manage")) or.push({ kind: "PRAISE" });
  const where: Prisma.FeedbackWhereInput = { AND: [{ OR: or }, ...(input.toId ? [{ toId: input.toId }] : [])] };
  const [rows, total] = await Promise.all([
    db.feedback.findMany({ where, select: praiseSelect, orderBy: { createdAt: "desc" }, ...paginate(input) }),
    db.feedback.count({ where }),
  ]);
  return toPage(rows.map(serializePraise), total, input);
}

export async function praiseLeaderboard(actor: Actor, period?: string | null) {
  await authorize(actor, "performance:read");
  const p = parsePeriod(period);
  const grouped = await db.feedback.groupBy({ by: ["toId"], where: { kind: "PRAISE", isPublic: true, createdAt: { gte: p.start, lte: addDays(p.end, 1) } }, _count: { _all: true }, orderBy: { _count: { toId: "desc" } }, take: 10 });
  const emps = grouped.length ? await db.employee.findMany({ where: { id: { in: grouped.map((g) => g.toId) } }, select: { id: true, displayName: true, department: { select: { name: true } } } }) : [];
  const byId = new Map(emps.map((e) => [e.id, e]));
  return { period: p.label, items: grouped.map((g) => ({ employeeId: g.toId, name: byId.get(g.toId)?.displayName ?? "Unknown", department: byId.get(g.toId)?.department?.name ?? null, count: g._count._all })) };
}

// ── Lookups for UI ─────────────────────────────────────────────────────

/** Small employee list for pickers (name search), limited to what the actor may see. */
export async function searchEmployees(actor: Actor, q: string, take = 20) {
  await authorize(actor, "employees:read");
  const rows = await db.employee.findMany({
    where: { status: { not: "EXITED" }, ...(q ? { OR: [{ displayName: { contains: q, mode: "insensitive" } }, { employeeCode: { contains: q, mode: "insensitive" } }, { workEmail: { contains: q, mode: "insensitive" } }] } : {}) },
    select: { id: true, displayName: true, employeeCode: true, designation: { select: { name: true } } },
    orderBy: { displayName: "asc" },
    take,
  });
  return rows.map((r) => ({ id: r.id, name: r.displayName, code: r.employeeCode, designation: r.designation?.name ?? null }));
}

export type { Pagination };
