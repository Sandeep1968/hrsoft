import "server-only";
import { z } from "zod";
import { Prisma, type ProjectStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { paginate, paginationSchema, toPage, zDateOnly, zUuid, type Pagination } from "@/lib/api";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { type Actor, authorize, can } from "@/lib/rbac/authorize";
import { dispatchWebhook } from "@/server/services/webhooks";

// ── Schemas ────────────────────────────────────────────────────────────

const PROJECT_STATUSES = ["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;

export const clientSchema = z.object({
  name: z.string().trim().min(1).max(160),
  contactName: z.string().trim().max(120).optional().nullable(),
  contactEmail: z.string().trim().email().max(200).optional().nullable().or(z.literal("").transform(() => null)),
  isActive: z.boolean().default(true),
});
export type ClientInput = z.infer<typeof clientSchema>;

export const projectSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, "Code may contain letters, digits and dashes")
    .transform((s) => s.toUpperCase()),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).optional().nullable(),
  clientId: zUuid.optional().nullable(),
  managerId: zUuid.optional().nullable(),
  startDate: zDateOnly.optional().nullable(),
  endDate: zDateOnly.optional().nullable(),
  status: z.enum(PROJECT_STATUSES).default("ACTIVE"),
  isBillable: z.boolean().default(true),
  budgetHours: z.coerce.number().min(0).max(1_000_000).optional().nullable(),
  hourlyRate: z.coerce.number().min(0).max(10_000_000).optional().nullable(),
});
export type ProjectInput = z.infer<typeof projectSchema>;
export const projectUpdateSchema = projectSchema.partial();

export const memberSchema = z.object({
  employeeId: zUuid,
  role: z.string().trim().min(1).max(40).default("MEMBER"),
  allocationPct: z.coerce.number().int().min(1).max(100).default(100),
});
export type MemberInput = z.infer<typeof memberSchema>;

export const taskSchema = z.object({
  name: z.string().trim().min(1).max(160),
  isBillable: z.boolean().default(true),
  estimateHours: z.coerce.number().min(0).max(100_000).optional().nullable(),
  status: z.enum(["OPEN", "IN_PROGRESS", "DONE", "CLOSED"]).default("OPEN"),
});
export type TaskInput = z.infer<typeof taskSchema>;

export const listProjectsSchema = paginationSchema.extend({
  status: z.enum(PROJECT_STATUSES).optional(),
  clientId: zUuid.optional(),
  managerId: zUuid.optional(),
});

export const utilisationSchema = z.object({ from: zDateOnly, to: zDateOnly, projectId: zUuid.optional() });

// ── Visibility helpers ─────────────────────────────────────────────────

/** Can the actor see every project (PMO / finance / HR)? */
export function seesAllProjects(actor: Actor): boolean {
  return can(actor, "projects:manage", "ALL") || can(actor, "timesheets:read", "ALL") || can(actor, "timesheets:approve", "ALL");
}

async function projectVisibilityWhere(actor: Actor): Promise<Prisma.ProjectWhereInput> {
  await authorize(actor, "projects:read");
  if (seesAllProjects(actor)) return {};
  const me = actor.employeeId ?? "00000000-0000-0000-0000-000000000000";
  return { OR: [{ managerId: me }, { members: { some: { employeeId: me } } }] };
}

/** Throws unless the actor manages this project or holds projects:manage ALL. */
async function requireProjectManager(actor: Actor, projectId: string) {
  await authorize(actor, "projects:manage");
  if (can(actor, "projects:manage", "ALL")) return;
  const p = await db.project.findUnique({ where: { id: projectId }, select: { managerId: true } });
  if (!p) throw new NotFoundError("Project");
  if (!actor.employeeId || p.managerId !== actor.employeeId) throw new ForbiddenError("Only the project manager can change this project");
}

const num = (d: Prisma.Decimal | number | null | undefined) => (d === null || d === undefined ? null : Number(d));

// ── Clients ────────────────────────────────────────────────────────────

export async function listClients(actor: Actor, p: Pagination & { includeInactive?: boolean }) {
  await authorize(actor, "projects:read");
  const where: Prisma.ClientWhereInput = {
    ...(p.includeInactive ? {} : { isActive: true }),
    ...(p.q ? { name: { contains: p.q, mode: "insensitive" } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.client.findMany({ where, orderBy: { name: "asc" }, ...paginate(p), include: { _count: { select: { projects: true } } } }),
    db.client.count({ where }),
  ]);
  return toPage(
    rows.map((c) => ({ id: c.id, name: c.name, contactName: c.contactName, contactEmail: c.contactEmail, isActive: c.isActive, projectCount: c._count.projects })),
    total,
    p,
  );
}

export async function getClient(actor: Actor, id: string) {
  await authorize(actor, "projects:read");
  const c = await db.client.findUnique({ where: { id }, include: { projects: { select: { id: true, code: true, name: true, status: true }, orderBy: { code: "asc" } } } });
  if (!c) throw new NotFoundError("Client");
  return c;
}

export async function createClient(actor: Actor, input: ClientInput) {
  await authorize(actor, "projects:manage");
  const c = await db.client.create({ data: input });
  await audit(actor, "projects.client_create", "Client", c.id, { after: input });
  return c;
}

export async function updateClient(actor: Actor, id: string, input: Partial<ClientInput>) {
  await authorize(actor, "projects:manage");
  const before = await db.client.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Client");
  const c = await db.client.update({ where: { id }, data: input });
  await audit(actor, "projects.client_update", "Client", id, { before, after: c });
  return c;
}

export async function deleteClient(actor: Actor, id: string) {
  await authorize(actor, "projects:manage");
  const before = await db.client.findUnique({ where: { id }, include: { _count: { select: { projects: true } } } });
  if (!before) throw new NotFoundError("Client");
  if (before._count.projects > 0) throw new ConflictError("Client still has projects; deactivate it instead");
  await db.client.delete({ where: { id } });
  await audit(actor, "projects.client_delete", "Client", id, { before: { name: before.name } });
  return { id };
}

// ── Projects ───────────────────────────────────────────────────────────

export interface ProjectListItem {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  isBillable: boolean;
  client: { id: string; name: string } | null;
  manager: { id: string; displayName: string } | null;
  startDate: string | null;
  endDate: string | null;
  budgetHours: number | null;
  hourlyRate: number | null;
  hoursLogged: number;
  memberCount: number;
  taskCount: number;
}

export async function listProjects(actor: Actor, p: z.infer<typeof listProjectsSchema>) {
  const vis = await projectVisibilityWhere(actor);
  const where: Prisma.ProjectWhereInput = {
    AND: [
      vis,
      p.status ? { status: p.status } : {},
      p.clientId ? { clientId: p.clientId } : {},
      p.managerId ? { managerId: p.managerId } : {},
      p.q ? { OR: [{ name: { contains: p.q, mode: "insensitive" } }, { code: { contains: p.q, mode: "insensitive" } }] } : {},
    ],
  };
  const orderBy: Prisma.ProjectOrderByWithRelationInput = p.sort === "name" ? { name: p.order } : p.sort === "status" ? { status: p.order } : { code: p.order };
  const [rows, total] = await Promise.all([
    db.project.findMany({
      where,
      orderBy,
      ...paginate(p),
      select: {
        id: true, code: true, name: true, status: true, isBillable: true, startDate: true, endDate: true, budgetHours: true, hourlyRate: true,
        client: { select: { id: true, name: true } },
        manager: { select: { id: true, displayName: true } },
        _count: { select: { members: true, tasks: true } },
      },
    }),
    db.project.count({ where }),
  ]);
  const ids = rows.map((r) => r.id);
  const hours = ids.length
    ? await db.$queryRaw<{ projectId: string; hours: number }[]>`
        SELECT e."projectId", COALESCE(SUM(e.hours), 0)::float AS hours
        FROM "TimesheetEntry" e JOIN "Timesheet" t ON t.id = e."timesheetId"
        WHERE e."projectId" = ANY(${ids}::uuid[]) AND t.status <> 'REJECTED'
        GROUP BY e."projectId"`
    : [];
  const hoursBy = new Map(hours.map((h) => [h.projectId, h.hours]));
  const items: ProjectListItem[] = rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    status: r.status,
    isBillable: r.isBillable,
    client: r.client,
    manager: r.manager,
    startDate: r.startDate?.toISOString().slice(0, 10) ?? null,
    endDate: r.endDate?.toISOString().slice(0, 10) ?? null,
    budgetHours: num(r.budgetHours),
    hourlyRate: num(r.hourlyRate),
    hoursLogged: hoursBy.get(r.id) ?? 0,
    memberCount: r._count.members,
    taskCount: r._count.tasks,
  }));
  return toPage(items, total, p);
}

export async function getProject(actor: Actor, id: string) {
  const vis = await projectVisibilityWhere(actor);
  const p = await db.project.findFirst({
    where: { AND: [{ id }, vis] },
    include: {
      client: { select: { id: true, name: true, contactName: true, contactEmail: true } },
      manager: { select: { id: true, displayName: true, employeeCode: true, workEmail: true } },
      members: { include: { employee: { select: { id: true, displayName: true, employeeCode: true, designation: { select: { name: true } }, department: { select: { name: true } } } } }, orderBy: { addedAt: "asc" } },
      tasks: { orderBy: { name: "asc" } },
    },
  });
  if (!p) throw new NotFoundError("Project");

  const [totals, byMember, byTask] = await Promise.all([
    db.$queryRaw<{ total: number; billable: number; approved: number }[]>`
      SELECT COALESCE(SUM(e.hours), 0)::float AS total,
             COALESCE(SUM(CASE WHEN e."isBillable" THEN e.hours ELSE 0 END), 0)::float AS billable,
             COALESCE(SUM(CASE WHEN t.status = 'APPROVED' THEN e.hours ELSE 0 END), 0)::float AS approved
      FROM "TimesheetEntry" e JOIN "Timesheet" t ON t.id = e."timesheetId"
      WHERE e."projectId" = ${id}::uuid AND t.status <> 'REJECTED'`,
    db.$queryRaw<{ employeeId: string; displayName: string; hours: number; billable: number }[]>`
      SELECT t."employeeId", emp."displayName", COALESCE(SUM(e.hours), 0)::float AS hours,
             COALESCE(SUM(CASE WHEN e."isBillable" THEN e.hours ELSE 0 END), 0)::float AS billable
      FROM "TimesheetEntry" e
        JOIN "Timesheet" t ON t.id = e."timesheetId"
        JOIN "Employee" emp ON emp.id = t."employeeId"
      WHERE e."projectId" = ${id}::uuid AND t.status <> 'REJECTED'
      GROUP BY t."employeeId", emp."displayName"
      ORDER BY hours DESC`,
    db.$queryRaw<{ taskId: string | null; hours: number }[]>`
      SELECT e."taskId", COALESCE(SUM(e.hours), 0)::float AS hours
      FROM "TimesheetEntry" e JOIN "Timesheet" t ON t.id = e."timesheetId"
      WHERE e."projectId" = ${id}::uuid AND t.status <> 'REJECTED'
      GROUP BY e."taskId"`,
  ]);
  const taskHours = new Map(byTask.map((t) => [t.taskId ?? "none", t.hours]));
  const memberHours = new Map(byMember.map((m) => [m.employeeId, m]));
  const t = totals[0] ?? { total: 0, billable: 0, approved: 0 };
  const budget = num(p.budgetHours);

  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    status: p.status,
    isBillable: p.isBillable,
    startDate: p.startDate?.toISOString().slice(0, 10) ?? null,
    endDate: p.endDate?.toISOString().slice(0, 10) ?? null,
    budgetHours: budget,
    hourlyRate: num(p.hourlyRate),
    client: p.client,
    manager: p.manager,
    createdAt: p.createdAt.toISOString(),
    canManage: can(actor, "projects:manage", "ALL") || (can(actor, "projects:manage") && !!actor.employeeId && p.managerId === actor.employeeId),
    hours: {
      total: t.total,
      billable: t.billable,
      nonBillable: t.total - t.billable,
      approved: t.approved,
      budget,
      budgetUsedPct: budget ? Math.round((t.total / budget) * 100) : null,
      billedValue: p.hourlyRate ? Math.round(t.billable * Number(p.hourlyRate)) : null,
    },
    members: p.members.map((m) => ({
      employeeId: m.employeeId,
      displayName: m.employee.displayName,
      employeeCode: m.employee.employeeCode,
      designation: m.employee.designation?.name ?? null,
      department: m.employee.department?.name ?? null,
      role: m.role,
      allocationPct: m.allocationPct,
      addedAt: m.addedAt.toISOString(),
      hours: memberHours.get(m.employeeId)?.hours ?? 0,
      billableHours: memberHours.get(m.employeeId)?.billable ?? 0,
    })),
    /** Hours logged by people who are no longer members (kept for reporting). */
    otherContributors: byMember.filter((m) => !p.members.some((x) => x.employeeId === m.employeeId)).map((m) => ({ employeeId: m.employeeId, displayName: m.displayName, hours: m.hours, billableHours: m.billable })),
    tasks: p.tasks.map((task) => ({
      id: task.id,
      name: task.name,
      isBillable: task.isBillable,
      estimateHours: num(task.estimateHours),
      status: task.status,
      hours: taskHours.get(task.id) ?? 0,
    })),
    unassignedTaskHours: taskHours.get("none") ?? 0,
  };
}
export type ProjectDetail = Awaited<ReturnType<typeof getProject>>;

export async function createProject(actor: Actor, input: ProjectInput) {
  await authorize(actor, "projects:manage");
  if (input.startDate && input.endDate && input.endDate.getTime() < input.startDate.getTime()) throw new ValidationError("End date must be after start date");
  if (await db.project.findUnique({ where: { code: input.code }, select: { id: true } })) throw new ConflictError(`Project code ${input.code} already exists`);
  // A PM without ALL scope always manages the projects they create.
  const managerId = can(actor, "projects:manage", "ALL") ? (input.managerId ?? actor.employeeId ?? null) : actor.employeeId;
  const p = await db.project.create({ data: { ...input, managerId } });
  await audit(actor, "projects.create", "Project", p.id, { after: { ...input, managerId } });
  dispatchWebhook("project.created", { id: p.id, code: p.code, name: p.name });
  return p;
}

export async function updateProject(actor: Actor, id: string, input: z.infer<typeof projectUpdateSchema>) {
  await requireProjectManager(actor, id);
  const before = await db.project.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Project");
  const start = input.startDate === undefined ? before.startDate : input.startDate;
  const end = input.endDate === undefined ? before.endDate : input.endDate;
  if (start && end && end.getTime() < start.getTime()) throw new ValidationError("End date must be after start date");
  if (input.code && input.code !== before.code && (await db.project.findUnique({ where: { code: input.code }, select: { id: true } }))) throw new ConflictError(`Project code ${input.code} already exists`);
  const p = await db.project.update({ where: { id }, data: input });
  await audit(actor, "projects.update", "Project", id, { before, after: p });
  return p;
}

export async function deleteProject(actor: Actor, id: string) {
  await authorize(actor, "projects:manage", { minScope: "ALL" });
  const before = await db.project.findUnique({ where: { id }, include: { _count: { select: { entries: true } } } });
  if (!before) throw new NotFoundError("Project");
  if (before._count.entries > 0) throw new ConflictError("Project has timesheet entries; mark it CANCELLED or COMPLETED instead");
  await db.project.delete({ where: { id } });
  await audit(actor, "projects.delete", "Project", id, { before: { code: before.code, name: before.name } });
  return { id };
}

// ── Members ────────────────────────────────────────────────────────────

export async function addMember(actor: Actor, projectId: string, input: MemberInput) {
  await requireProjectManager(actor, projectId);
  const emp = await db.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, status: true, displayName: true } });
  if (!emp) throw new NotFoundError("Employee");
  if (emp.status === "EXITED") throw new ValidationError("Cannot add an exited employee");
  const project = await db.project.findUnique({ where: { id: projectId }, select: { code: true, name: true } });
  if (!project) throw new NotFoundError("Project");
  const m = await db.projectMember.upsert({
    where: { projectId_employeeId: { projectId, employeeId: input.employeeId } },
    create: { projectId, ...input },
    update: { role: input.role, allocationPct: input.allocationPct },
  });
  await audit(actor, "projects.member_add", "ProjectMember", `${projectId}:${input.employeeId}`, { after: input });
  await notify({ employeeId: input.employeeId, type: "project.member_added", title: `You were added to project ${project.code}`, body: `${project.name} · ${input.allocationPct}% allocation`, link: `/projects/${projectId}` });
  return m;
}

export async function removeMember(actor: Actor, projectId: string, employeeId: string) {
  await requireProjectManager(actor, projectId);
  const r = await db.projectMember.deleteMany({ where: { projectId, employeeId } });
  if (r.count === 0) throw new NotFoundError("Project member");
  await audit(actor, "projects.member_remove", "ProjectMember", `${projectId}:${employeeId}`);
  return { projectId, employeeId };
}

// ── Tasks ──────────────────────────────────────────────────────────────

export async function listTasks(actor: Actor, projectId: string) {
  const vis = await projectVisibilityWhere(actor);
  const p = await db.project.findFirst({ where: { AND: [{ id: projectId }, vis] }, select: { id: true } });
  if (!p) throw new NotFoundError("Project");
  const tasks = await db.projectTask.findMany({ where: { projectId }, orderBy: { name: "asc" } });
  return tasks.map((t) => ({ ...t, estimateHours: num(t.estimateHours) }));
}

export async function createTask(actor: Actor, projectId: string, input: TaskInput) {
  await requireProjectManager(actor, projectId);
  const t = await db.projectTask.create({ data: { projectId, ...input } });
  await audit(actor, "projects.task_create", "ProjectTask", t.id, { after: input });
  return { ...t, estimateHours: num(t.estimateHours) };
}

export async function updateTask(actor: Actor, projectId: string, taskId: string, input: Partial<TaskInput>) {
  await requireProjectManager(actor, projectId);
  const before = await db.projectTask.findFirst({ where: { id: taskId, projectId } });
  if (!before) throw new NotFoundError("Task");
  const t = await db.projectTask.update({ where: { id: taskId }, data: input });
  await audit(actor, "projects.task_update", "ProjectTask", taskId, { before, after: t });
  return { ...t, estimateHours: num(t.estimateHours) };
}

export async function deleteTask(actor: Actor, projectId: string, taskId: string) {
  await requireProjectManager(actor, projectId);
  const before = await db.projectTask.findFirst({ where: { id: taskId, projectId }, include: { _count: { select: { entries: true } } } });
  if (!before) throw new NotFoundError("Task");
  if (before._count.entries > 0) throw new ConflictError("Task has logged hours; close it instead of deleting");
  await db.projectTask.delete({ where: { id: taskId } });
  await audit(actor, "projects.task_delete", "ProjectTask", taskId, { before: { name: before.name } });
  return { id: taskId };
}

// ── Utilisation ────────────────────────────────────────────────────────

export async function projectUtilisation(actor: Actor, params: z.infer<typeof utilisationSchema>) {
  await authorize(actor, "projects:read");
  if (params.to.getTime() < params.from.getTime()) throw new ValidationError("`to` must be after `from`");
  const restrictToMine = !seesAllProjects(actor);
  const me = actor.employeeId ?? "00000000-0000-0000-0000-000000000000";
  const projectFilter = params.projectId ? Prisma.sql`AND p.id = ${params.projectId}::uuid` : Prisma.empty;
  const scopeFilter = restrictToMine ? Prisma.sql`AND (p."managerId" = ${me}::uuid OR t."employeeId" = ${me}::uuid)` : Prisma.empty;

  const [byProject, byEmployee, capacity] = await Promise.all([
    db.$queryRaw<{ projectId: string; code: string; name: string; hours: number; billable: number; people: number }[]>`
      SELECT p.id AS "projectId", p.code, p.name, COALESCE(SUM(e.hours), 0)::float AS hours,
             COALESCE(SUM(CASE WHEN e."isBillable" THEN e.hours ELSE 0 END), 0)::float AS billable,
             COUNT(DISTINCT t."employeeId")::int AS people
      FROM "TimesheetEntry" e
        JOIN "Timesheet" t ON t.id = e."timesheetId"
        JOIN "Project" p ON p.id = e."projectId"
      WHERE e.date BETWEEN ${params.from}::date AND ${params.to}::date AND t.status <> 'REJECTED' ${projectFilter} ${scopeFilter}
      GROUP BY p.id, p.code, p.name
      ORDER BY hours DESC
      LIMIT 200`,
    db.$queryRaw<{ employeeId: string; displayName: string; employeeCode: string; hours: number; billable: number; projects: number }[]>`
      SELECT t."employeeId", emp."displayName", emp."employeeCode", COALESCE(SUM(e.hours), 0)::float AS hours,
             COALESCE(SUM(CASE WHEN e."isBillable" THEN e.hours ELSE 0 END), 0)::float AS billable,
             COUNT(DISTINCT e."projectId")::int AS projects
      FROM "TimesheetEntry" e
        JOIN "Timesheet" t ON t.id = e."timesheetId"
        JOIN "Project" p ON p.id = e."projectId"
        JOIN "Employee" emp ON emp.id = t."employeeId"
      WHERE e.date BETWEEN ${params.from}::date AND ${params.to}::date AND t.status <> 'REJECTED' ${projectFilter} ${scopeFilter}
      GROUP BY t."employeeId", emp."displayName", emp."employeeCode"
      ORDER BY hours DESC
      LIMIT 200`,
    db.$queryRaw<{ days: number }[]>`
      SELECT COUNT(*)::int AS days FROM generate_series(${params.from}::date, ${params.to}::date, '1 day') d WHERE EXTRACT(ISODOW FROM d) < 6`,
  ]);
  const workingDays = capacity[0]?.days ?? 0;
  const capacityHours = workingDays * 8;
  return {
    from: params.from.toISOString().slice(0, 10),
    to: params.to.toISOString().slice(0, 10),
    workingDays,
    capacityHoursPerPerson: capacityHours,
    byProject,
    byEmployee: byEmployee.map((r) => ({ ...r, utilisationPct: capacityHours ? Math.round((r.hours / capacityHours) * 100) : null })),
    totals: {
      hours: byProject.reduce((a, b) => a + b.hours, 0),
      billable: byProject.reduce((a, b) => a + b.billable, 0),
    },
  };
}
