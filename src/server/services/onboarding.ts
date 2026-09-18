import "server-only";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { addDays, toDateOnly } from "@/lib/dates";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { zUuid } from "@/lib/api";
import { type Actor, authorize, can, requireEmployee, visibleEmployeeIds } from "@/lib/rbac/authorize";
import type { OnboardingAssignee, TaskStatus } from "@/generated/prisma/client";

// ── Schemas ────────────────────────────────────────────────────────────

const ASSIGNEES = ["EMPLOYEE", "MANAGER", "HR", "IT", "FINANCE"] as const;

export const templateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  assigneeType: z.enum(ASSIGNEES).default("EMPLOYEE"),
  dueDaysAfterJoining: z.coerce.number().int().min(-30).max(365).default(7),
  order: z.coerce.number().int().min(0).default(0),
});

export const templateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  isDefault: z.boolean().default(false),
  tasks: z.array(templateTaskSchema).max(100).default([]),
});
export type TemplateInput = z.infer<typeof templateSchema>;

// ── Templates ──────────────────────────────────────────────────────────

export async function listTemplates(actor: Actor) {
  await authorize(actor, "onboarding:read");
  const rows = await db.onboardingTemplate.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    include: { tasks: { orderBy: { order: "asc" } } },
  });
  return rows.map(serializeTemplate);
}

export async function getTemplate(actor: Actor, id: string) {
  await authorize(actor, "onboarding:read");
  const t = await db.onboardingTemplate.findUnique({ where: { id }, include: { tasks: { orderBy: { order: "asc" } } } });
  if (!t) throw new NotFoundError("Onboarding template");
  return serializeTemplate(t);
}

export async function createTemplate(actor: Actor, input: TemplateInput) {
  await authorize(actor, "onboarding:manage");
  const t = await db.$transaction(async (tx) => {
    if (input.isDefault) await tx.onboardingTemplate.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    return tx.onboardingTemplate.create({
      data: {
        name: input.name,
        isDefault: input.isDefault,
        tasks: { create: input.tasks.map((task, i) => ({ ...task, order: task.order || i + 1 })) },
      },
      include: { tasks: { orderBy: { order: "asc" } } },
    });
  });
  await audit(actor, "onboarding.template_create", "OnboardingTemplate", t.id, { after: input });
  return serializeTemplate(t);
}

export async function updateTemplate(actor: Actor, id: string, input: TemplateInput) {
  await authorize(actor, "onboarding:manage");
  const before = await db.onboardingTemplate.findUnique({ where: { id }, include: { tasks: true } });
  if (!before) throw new NotFoundError("Onboarding template");
  const t = await db.$transaction(async (tx) => {
    if (input.isDefault) await tx.onboardingTemplate.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
    await tx.onboardingTemplateTask.deleteMany({ where: { templateId: id } });
    return tx.onboardingTemplate.update({
      where: { id },
      data: {
        name: input.name,
        isDefault: input.isDefault,
        tasks: { create: input.tasks.map((task, i) => ({ ...task, order: task.order || i + 1 })) },
      },
      include: { tasks: { orderBy: { order: "asc" } } },
    });
  });
  await audit(actor, "onboarding.template_update", "OnboardingTemplate", id, { before: { name: before.name, tasks: before.tasks.length }, after: input });
  return serializeTemplate(t);
}

export async function deleteTemplate(actor: Actor, id: string) {
  await authorize(actor, "onboarding:manage");
  const t = await db.onboardingTemplate.findUnique({ where: { id }, select: { id: true, isDefault: true, name: true } });
  if (!t) throw new NotFoundError("Onboarding template");
  if (t.isDefault) throw new ForbiddenError("The default template cannot be deleted; mark another template as default first");
  await db.onboardingTemplate.delete({ where: { id } });
  await audit(actor, "onboarding.template_delete", "OnboardingTemplate", id, { before: t });
  return { id };
}

function serializeTemplate(t: {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: Date;
  tasks: { id: string; title: string; description: string | null; assigneeType: OnboardingAssignee; dueDaysAfterJoining: number; order: number }[];
}) {
  return {
    id: t.id,
    name: t.name,
    isDefault: t.isDefault,
    createdAt: t.createdAt.toISOString(),
    tasks: t.tasks.map((x) => ({ id: x.id, title: x.title, description: x.description, assigneeType: x.assigneeType, dueDaysAfterJoining: x.dueDaysAfterJoining, order: x.order })),
  };
}

// ── Applying a template (usable inside a transaction) ──────────────────

/**
 * Copies the template's tasks onto an employee record. Returns the number of
 * tasks created (0 when no template exists). Safe to call inside `db.$transaction`.
 */
export async function applyOnboardingTemplate(tx: Tx, employeeId: string, joiningDate: Date, templateId?: string | null): Promise<number> {
  const template = templateId
    ? await tx.onboardingTemplate.findUnique({ where: { id: templateId }, include: { tasks: true } })
    : await tx.onboardingTemplate.findFirst({ where: { isDefault: true }, include: { tasks: true } });
  if (!template || template.tasks.length === 0) return 0;
  const base = toDateOnly(joiningDate);
  const r = await tx.onboardingTask.createMany({
    data: template.tasks.map((t) => ({
      employeeId,
      title: t.title,
      description: t.description,
      assigneeType: t.assigneeType,
      dueDate: addDays(base, t.dueDaysAfterJoining),
      order: t.order,
      status: "PENDING",
    })),
  });
  return r.count;
}

// ── Tasks ──────────────────────────────────────────────────────────────

export interface OnboardingTaskDto {
  id: string;
  employeeId: string;
  employeeName: string;
  title: string;
  description: string | null;
  assigneeType: OnboardingAssignee;
  dueDate: string | null;
  status: TaskStatus;
  completedAt: string | null;
  order: number;
  canComplete: boolean;
}

/** Tasks on the actor's own record, plus MANAGER tasks for their direct reports. */
export async function listMyOnboardingTasks(actor: Actor): Promise<{ mine: OnboardingTaskDto[]; team: OnboardingTaskDto[] }> {
  if (!actor.employeeId) return { mine: [], team: [] };
  const employeeId = requireEmployee(actor);
  const [mine, team] = await Promise.all([
    db.onboardingTask.findMany({
      where: { employeeId },
      orderBy: [{ status: "asc" }, { order: "asc" }],
      include: { employee: { select: { displayName: true } } },
    }),
    db.onboardingTask.findMany({
      where: { assigneeType: "MANAGER", status: { in: ["PENDING", "IN_PROGRESS"] }, employee: { managerId: employeeId } },
      orderBy: [{ dueDate: "asc" }],
      include: { employee: { select: { displayName: true } } },
    }),
  ]);
  const manage = can(actor, "onboarding:manage");
  return {
    mine: mine.map((t) => toTaskDto(t, t.assigneeType === "EMPLOYEE" || manage)),
    team: team.map((t) => toTaskDto(t, true)),
  };
}

/** Tasks for a specific employee (HR/manager view or self). */
export async function listEmployeeOnboardingTasks(actor: Actor, employeeId: string): Promise<OnboardingTaskDto[]> {
  await authorize(actor, "onboarding:read", { employeeId });
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { managerId: true } });
  if (!emp) throw new NotFoundError("Employee");
  const rows = await db.onboardingTask.findMany({ where: { employeeId }, orderBy: [{ status: "asc" }, { order: "asc" }], include: { employee: { select: { displayName: true } } } });
  const manage = can(actor, "onboarding:manage");
  const isSelf = actor.employeeId === employeeId;
  const isManager = actor.employeeId !== null && actor.employeeId === emp.managerId;
  return rows.map((t) => toTaskDto(t, manage || (isSelf && t.assigneeType === "EMPLOYEE") || (isManager && t.assigneeType === "MANAGER")));
}

export interface OnboardingOverviewRow {
  id: string;
  employeeCode: string;
  displayName: string;
  workEmail: string;
  joiningDate: string;
  department: string | null;
  designation: string | null;
  manager: string | null;
  total: number;
  completed: number;
  overdue: number;
}

/** Employees in ONBOARDING status with task progress. */
export async function listOnboardingOverview(actor: Actor): Promise<OnboardingOverviewRow[]> {
  const ids = await visibleEmployeeIds(actor, "onboarding:read");
  if (ids !== null && ids.length === 0) return [];
  const employees = await db.employee.findMany({
    where: { status: "ONBOARDING", ...(ids ? { id: { in: ids } } : {}) },
    orderBy: { joiningDate: "asc" },
    take: 500,
    select: {
      id: true,
      employeeCode: true,
      displayName: true,
      workEmail: true,
      joiningDate: true,
      department: { select: { name: true } },
      designation: { select: { name: true } },
      manager: { select: { displayName: true } },
    },
  });
  if (employees.length === 0) return [];
  const empIds = employees.map((e) => e.id);
  const today = toDateOnly(new Date());
  const [totals, done, overdue] = await Promise.all([
    db.onboardingTask.groupBy({ by: ["employeeId"], where: { employeeId: { in: empIds } }, _count: { _all: true } }),
    db.onboardingTask.groupBy({ by: ["employeeId"], where: { employeeId: { in: empIds }, status: { in: ["COMPLETED", "SKIPPED"] } }, _count: { _all: true } }),
    db.onboardingTask.groupBy({ by: ["employeeId"], where: { employeeId: { in: empIds }, status: { in: ["PENDING", "IN_PROGRESS"] }, dueDate: { lt: today } }, _count: { _all: true } }),
  ]);
  const m = (rows: { employeeId: string; _count: { _all: number } }[]) => new Map(rows.map((r) => [r.employeeId, r._count._all]));
  const tm = m(totals), dm = m(done), om = m(overdue);
  return employees.map((e) => ({
    id: e.id,
    employeeCode: e.employeeCode,
    displayName: e.displayName,
    workEmail: e.workEmail,
    joiningDate: e.joiningDate.toISOString().slice(0, 10),
    department: e.department?.name ?? null,
    designation: e.designation?.name ?? null,
    manager: e.manager?.displayName ?? null,
    total: tm.get(e.id) ?? 0,
    completed: dm.get(e.id) ?? 0,
    overdue: om.get(e.id) ?? 0,
  }));
}

export const completeTaskSchema = z.object({ status: z.enum(["COMPLETED", "SKIPPED"]).default("COMPLETED") });

/**
 * Completion rules: EMPLOYEE tasks by the employee themselves; MANAGER tasks by
 * their manager; HR / IT / FINANCE (and anything else) by `onboarding:manage`.
 */
export async function completeTask(actor: Actor, taskId: string, status: "COMPLETED" | "SKIPPED" = "COMPLETED") {
  const task = await db.onboardingTask.findUnique({ where: { id: taskId }, include: { employee: { select: { id: true, managerId: true, displayName: true, userId: true } } } });
  if (!task) throw new NotFoundError("Onboarding task");
  const manage = can(actor, "onboarding:manage");
  const isSelf = actor.employeeId !== null && actor.employeeId === task.employee.id;
  const isManager = actor.employeeId !== null && actor.employeeId === task.employee.managerId;
  const allowed = manage || (task.assigneeType === "EMPLOYEE" && isSelf) || (task.assigneeType === "MANAGER" && isManager);
  if (!allowed) throw new ForbiddenError("You cannot complete this onboarding task");
  if (task.status === "COMPLETED" || task.status === "SKIPPED") return toTaskDto(task, allowed);

  const updated = await db.onboardingTask.update({ where: { id: taskId }, data: { status, completedAt: new Date() }, include: { employee: { select: { displayName: true } } } });
  await audit(actor, "onboarding.task_complete", "OnboardingTask", taskId, { before: { status: task.status }, after: { status } });

  // Auto-activate the employee when every task on the record is done.
  const remaining = await db.onboardingTask.count({ where: { employeeId: task.employeeId, status: { in: ["PENDING", "IN_PROGRESS"] } } });
  if (remaining === 0) {
    const emp = await db.employee.findUnique({ where: { id: task.employeeId }, select: { status: true, joiningDate: true } });
    if (emp?.status === "ONBOARDING" && emp.joiningDate.getTime() <= toDateOnly(new Date()).getTime()) {
      await db.employee.update({ where: { id: task.employeeId }, data: { status: "ACTIVE" } });
      await audit(actor, "employees.activate", "Employee", task.employeeId, { before: { status: "ONBOARDING" }, after: { status: "ACTIVE" } });
    }
  }
  if (!isSelf) {
    await notify({ employeeId: task.employeeId, type: "onboarding", title: `Onboarding task completed: ${task.title}`, body: `Marked ${status.toLowerCase()} by ${actor.name}.`, link: "/me?tab=onboarding" });
  }
  return toTaskDto(updated, allowed);
}

/** Adds an ad-hoc task to an employee's onboarding checklist. */
export const addTaskSchema = z.object({
  employeeId: zUuid,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  assigneeType: z.enum(ASSIGNEES).default("EMPLOYEE"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

export async function addTask(actor: Actor, input: z.infer<typeof addTaskSchema>) {
  await authorize(actor, "onboarding:manage", { employeeId: input.employeeId });
  const max = await db.onboardingTask.aggregate({ where: { employeeId: input.employeeId }, _max: { order: true } });
  const t = await db.onboardingTask.create({
    data: { employeeId: input.employeeId, title: input.title, description: input.description ?? null, assigneeType: input.assigneeType, dueDate: input.dueDate ? toDateOnly(input.dueDate) : null, order: (max._max.order ?? 0) + 1 },
    include: { employee: { select: { displayName: true } } },
  });
  await audit(actor, "onboarding.task_add", "OnboardingTask", t.id, { after: input });
  return toTaskDto(t, true);
}

function toTaskDto(
  t: { id: string; employeeId: string; title: string; description: string | null; assigneeType: OnboardingAssignee; dueDate: Date | null; status: TaskStatus; completedAt: Date | null; order: number; employee: { displayName: string } },
  canComplete: boolean,
): OnboardingTaskDto {
  return {
    id: t.id,
    employeeId: t.employeeId,
    employeeName: t.employee.displayName,
    title: t.title,
    description: t.description,
    assigneeType: t.assigneeType,
    dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
    status: t.status,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    order: t.order,
    canComplete: canComplete && (t.status === "PENDING" || t.status === "IN_PROGRESS"),
  };
}
