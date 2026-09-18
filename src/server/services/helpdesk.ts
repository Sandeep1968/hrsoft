import "server-only";
import { z } from "zod";
import { Prisma, type TicketPriority, type TicketStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { paginate, paginationSchema, toPage, zUuid } from "@/lib/api";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { type Actor, authorize, can, requireEmployee, scopeFilter } from "@/lib/rbac/authorize";
import { dispatchWebhook } from "@/server/services/webhooks";

// ── Schemas ────────────────────────────────────────────────────────────

const STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_ON_EMPLOYEE", "RESOLVED", "CLOSED"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export const ticketCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  slaHours: z.coerce.number().int().min(1).max(24 * 90).default(48),
  assigneeRoleKey: z.string().trim().regex(/^[A-Z][A-Z0-9_]*$/, "Role key must be UPPER_SNAKE").max(40).optional().nullable().or(z.literal("").transform(() => null)),
});
export type TicketCategoryInput = z.infer<typeof ticketCategorySchema>;

export const raiseTicketSchema = z.object({
  categoryId: zUuid,
  subject: z.string().trim().min(3).max(200),
  description: z.string().trim().min(3).max(10_000),
  priority: z.enum(PRIORITIES).default("MEDIUM"),
});
export type RaiseTicketInput = z.infer<typeof raiseTicketSchema>;

export const commentSchema = z.object({ body: z.string().trim().min(1).max(10_000), isInternal: z.boolean().default(false) });

export const updateTicketSchema = z.object({
  status: z.enum(STATUSES).optional(),
  assigneeId: zUuid.nullable().optional(),
  priority: z.enum(PRIORITIES).optional(),
});

export const listTicketsSchema = paginationSchema.extend({
  status: z.enum(STATUSES).optional(),
  statusGroup: z.enum(["open", "closed"]).optional(),
  mine: z.coerce.boolean().optional(),
  assignedToMe: z.coerce.boolean().optional(),
  unassigned: z.coerce.boolean().optional(),
  categoryId: zUuid.optional(),
  priority: z.enum(PRIORITIES).optional(),
  overdue: z.coerce.boolean().optional(),
});

const OPEN_STATUSES: TicketStatus[] = ["OPEN", "IN_PROGRESS", "WAITING_ON_EMPLOYEE"];

// ── Categories ─────────────────────────────────────────────────────────

export async function listTicketCategories(actor: Actor) {
  if (!can(actor, "helpdesk:read") && !can(actor, "helpdesk:raise") && !can(actor, "helpdesk:agent")) throw new ForbiddenError("Missing permission helpdesk:read");
  const rows = await db.ticketCategory.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { tickets: true } } } });
  return rows.map((c) => ({ id: c.id, name: c.name, slaHours: c.slaHours, assigneeRoleKey: c.assigneeRoleKey, ticketCount: c._count.tickets }));
}

export async function createTicketCategory(actor: Actor, input: TicketCategoryInput) {
  await authorize(actor, "helpdesk:manage");
  if (input.assigneeRoleKey && !(await db.role.findUnique({ where: { key: input.assigneeRoleKey }, select: { id: true } }))) throw new ValidationError(`Role ${input.assigneeRoleKey} does not exist`);
  const c = await db.ticketCategory.create({ data: input });
  await audit(actor, "helpdesk.category_create", "TicketCategory", c.id, { after: input });
  return c;
}

export async function updateTicketCategory(actor: Actor, id: string, input: Partial<TicketCategoryInput>) {
  await authorize(actor, "helpdesk:manage");
  const before = await db.ticketCategory.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Ticket category");
  if (input.assigneeRoleKey && !(await db.role.findUnique({ where: { key: input.assigneeRoleKey }, select: { id: true } }))) throw new ValidationError(`Role ${input.assigneeRoleKey} does not exist`);
  const c = await db.ticketCategory.update({ where: { id }, data: input });
  await audit(actor, "helpdesk.category_update", "TicketCategory", id, { before, after: c });
  return c;
}

export async function deleteTicketCategory(actor: Actor, id: string) {
  await authorize(actor, "helpdesk:manage");
  const before = await db.ticketCategory.findUnique({ where: { id }, include: { _count: { select: { tickets: true } } } });
  if (!before) throw new NotFoundError("Ticket category");
  if (before._count.tickets > 0) throw new ConflictError("Category has tickets and cannot be deleted");
  await db.ticketCategory.delete({ where: { id } });
  await audit(actor, "helpdesk.category_delete", "TicketCategory", id, { before: { name: before.name } });
  return { id };
}

// ── Helpers ────────────────────────────────────────────────────────────

const isAgent = (actor: Actor) => can(actor, "helpdesk:agent") || can(actor, "helpdesk:manage");

/** Employee linked to a user holding `roleKey` with the fewest open tickets (excluding the raiser when possible). */
async function pickAssignee(roleKey: string, raiserId: string): Promise<string | null> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT e.id
    FROM "Employee" e
      JOIN "User" u ON u.id = e."userId" AND u.status = 'ACTIVE'
      JOIN "UserRole" ur ON ur."userId" = u.id
      JOIN "Role" r ON r.id = ur."roleId" AND r.key = ${roleKey}
      LEFT JOIN "Ticket" t ON t."assigneeId" = e.id AND t.status IN ('OPEN', 'IN_PROGRESS')
    WHERE e.status IN ('ACTIVE', 'ON_NOTICE')
    GROUP BY e.id
    ORDER BY (e.id = ${raiserId}::uuid) ASC, COUNT(t.id) ASC, e.id ASC
    LIMIT 1`;
  return rows[0]?.id ?? null;
}

const ticketInclude = {
  category: { select: { id: true, name: true, slaHours: true, assigneeRoleKey: true } },
  employee: { select: { id: true, displayName: true, employeeCode: true, department: { select: { name: true } } } },
  assignee: { select: { id: true, displayName: true } },
} satisfies Prisma.TicketInclude;

type TicketRow = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>;

function serializeTicket(t: TicketRow) {
  const now = Date.now();
  return {
    id: t.id,
    number: t.number,
    subject: t.subject,
    description: t.description,
    priority: t.priority,
    status: t.status,
    category: t.category,
    raiser: t.employee,
    assignee: t.assignee,
    dueAt: t.dueAt?.toISOString() ?? null,
    isOverdue: !!t.dueAt && OPEN_STATUSES.includes(t.status) && t.dueAt.getTime() < now,
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
    closedAt: t.closedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
export type TicketDto = ReturnType<typeof serializeTicket>;

/** Categories an agent works: those whose assigneeRoleKey is one of the actor's roles. */
async function agentCategoryIds(actor: Actor): Promise<string[]> {
  if (actor.roles.length === 0) return [];
  const rows = await db.ticketCategory.findMany({ where: { assigneeRoleKey: { in: actor.roles } }, select: { id: true } });
  return rows.map((r) => r.id);
}

async function loadTicket(id: string) {
  const t = await db.ticket.findUnique({ where: { id }, include: ticketInclude });
  if (!t) throw new NotFoundError("Ticket");
  return t;
}

/** Actor may see the ticket as raiser (within helpdesk:read scope), assignee, agent of the category, or manager. */
async function canViewTicket(actor: Actor, t: TicketRow): Promise<{ ok: boolean; asAgent: boolean }> {
  if (can(actor, "helpdesk:manage")) return { ok: true, asAgent: true };
  if (actor.employeeId && t.assigneeId === actor.employeeId && can(actor, "helpdesk:agent")) return { ok: true, asAgent: true };
  if (can(actor, "helpdesk:agent")) {
    const cats = await agentCategoryIds(actor);
    if (cats.includes(t.categoryId)) return { ok: true, asAgent: true };
  }
  if (can(actor, "helpdesk:read")) {
    const ok = await authorize(actor, "helpdesk:read", { employeeId: t.employeeId }).then(() => true).catch(() => false);
    if (ok) return { ok: true, asAgent: false };
  }
  return { ok: false, asAgent: false };
}

// ── Tickets ────────────────────────────────────────────────────────────

export async function raiseTicket(actor: Actor, input: RaiseTicketInput) {
  const employeeId = requireEmployee(actor);
  await authorize(actor, "helpdesk:raise", { employeeId });
  const category = await db.ticketCategory.findUnique({ where: { id: input.categoryId } });
  if (!category) throw new NotFoundError("Ticket category");
  const assigneeId = category.assigneeRoleKey ? await pickAssignee(category.assigneeRoleKey, employeeId) : null;
  const dueAt = new Date(Date.now() + category.slaHours * 3_600_000);
  const t = await db.ticket.create({
    data: { employeeId, categoryId: input.categoryId, subject: input.subject, description: input.description, priority: input.priority, dueAt, assigneeId, status: "OPEN" },
    include: ticketInclude,
  });
  await audit(actor, "helpdesk.ticket_raise", "Ticket", t.id, { after: { number: t.number, subject: t.subject, categoryId: t.categoryId, priority: t.priority, assigneeId } });
  if (assigneeId) await notify({ employeeId: assigneeId, type: "ticket.assigned", title: `New ticket #${t.number}: ${t.subject}`, body: `${category.name} · ${t.priority} · due ${dueAt.toISOString().slice(0, 16).replace("T", " ")} UTC`, link: `/helpdesk/${t.id}` });
  dispatchWebhook("ticket.created", { id: t.id, number: t.number, category: category.name, priority: t.priority, assigneeId });
  return serializeTicket(t);
}

export async function listTickets(actor: Actor, p: z.infer<typeof listTicketsSchema>) {
  const me = actor.employeeId;
  let visibility: Prisma.TicketWhereInput;
  if (can(actor, "helpdesk:manage")) visibility = {};
  else if (can(actor, "helpdesk:agent")) {
    const cats = await agentCategoryIds(actor);
    const own: Prisma.TicketWhereInput[] = [];
    if (me) own.push({ assigneeId: me });
    own.push({ assigneeId: null, categoryId: { in: cats } });
    if (me && can(actor, "helpdesk:read")) own.push({ employeeId: me });
    visibility = { OR: own };
  } else {
    visibility = (await scopeFilter(actor, "helpdesk:read")) as Prisma.TicketWhereInput;
  }
  const where: Prisma.TicketWhereInput = {
    AND: [
      visibility,
      p.status ? { status: p.status } : {},
      p.statusGroup === "open" ? { status: { in: OPEN_STATUSES } } : p.statusGroup === "closed" ? { status: { in: ["RESOLVED", "CLOSED"] } } : {},
      p.mine ? { employeeId: me ?? "00000000-0000-0000-0000-000000000000" } : {},
      p.assignedToMe ? { assigneeId: me ?? "00000000-0000-0000-0000-000000000000" } : {},
      p.unassigned ? { assigneeId: null } : {},
      p.categoryId ? { categoryId: p.categoryId } : {},
      p.priority ? { priority: p.priority } : {},
      p.overdue ? { dueAt: { lt: new Date() }, status: { in: OPEN_STATUSES } } : {},
      p.q ? { OR: [{ subject: { contains: p.q, mode: "insensitive" } }, ...(Number.isInteger(Number(p.q)) ? [{ number: Number(p.q) }] : [])] } : {},
    ],
  };
  const [rows, total] = await Promise.all([
    db.ticket.findMany({ where, orderBy: [{ createdAt: p.order === "asc" ? "asc" : "desc" }], ...paginate(p), include: ticketInclude }),
    db.ticket.count({ where }),
  ]);
  return toPage(rows.map(serializeTicket), total, p);
}

export async function getTicket(actor: Actor, id: string) {
  const t = await loadTicket(id);
  const v = await canViewTicket(actor, t);
  if (!v.ok) throw new ForbiddenError();
  const comments = await db.ticketComment.findMany({
    where: { ticketId: id, ...(v.asAgent ? {} : { isInternal: false }) },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, displayName: true } } },
  });
  return {
    ...serializeTicket(t),
    viewerIsAgent: v.asAgent,
    viewerIsRaiser: actor.employeeId === t.employeeId,
    canManage: can(actor, "helpdesk:manage"),
    comments: comments.map((c) => ({ id: c.id, body: c.body, isInternal: c.isInternal, author: c.author, isAgent: c.authorId !== t.employeeId, createdAt: c.createdAt.toISOString() })),
  };
}
export type TicketDetail = Awaited<ReturnType<typeof getTicket>>;

export async function addComment(actor: Actor, ticketId: string, input: z.infer<typeof commentSchema>) {
  const authorId = requireEmployee(actor);
  const t = await loadTicket(ticketId);
  const v = await canViewTicket(actor, t);
  if (!v.ok) throw new ForbiddenError();
  if (t.status === "CLOSED") throw new ConflictError("Ticket is closed; reopen it to continue the conversation");
  if (input.isInternal && !v.asAgent) throw new ForbiddenError("Only agents can add internal notes");
  const raiserReplying = authorId === t.employeeId && !v.asAgent;
  let nextStatus: TicketStatus | null = null;
  if (!input.isInternal) {
    if (v.asAgent && authorId !== t.employeeId && (t.status === "OPEN" || t.status === "IN_PROGRESS")) nextStatus = "WAITING_ON_EMPLOYEE";
    if (raiserReplying && (t.status === "WAITING_ON_EMPLOYEE" || t.status === "RESOLVED")) nextStatus = "IN_PROGRESS";
  }
  const [c] = await db.$transaction([
    db.ticketComment.create({ data: { ticketId, authorId, body: input.body, isInternal: input.isInternal }, include: { author: { select: { id: true, displayName: true } } } }),
    ...(nextStatus ? [db.ticket.update({ where: { id: ticketId }, data: { status: nextStatus, ...(nextStatus === "IN_PROGRESS" ? { resolvedAt: null } : {}) } })] : []),
  ]);
  await audit(actor, "helpdesk.comment", "Ticket", ticketId, { after: { isInternal: input.isInternal, status: nextStatus ?? t.status } });
  if (!input.isInternal) {
    if (authorId !== t.employeeId) await notify({ employeeId: t.employeeId, type: "ticket.reply", title: `Reply on ticket #${t.number}`, body: input.body.slice(0, 200), link: `/helpdesk/${ticketId}` });
    else if (t.assigneeId) await notify({ employeeId: t.assigneeId, type: "ticket.reply", title: `${t.employee.displayName} replied on #${t.number}`, body: input.body.slice(0, 200), link: `/helpdesk/${ticketId}` });
  }
  return { id: c.id, body: c.body, isInternal: c.isInternal, author: c.author, isAgent: authorId !== t.employeeId, createdAt: c.createdAt.toISOString(), status: nextStatus ?? t.status };
}

export async function assignTicket(actor: Actor, ticketId: string, assigneeId: string | null) {
  const t = await loadTicket(ticketId);
  const selfAssign = assigneeId !== null && assigneeId === actor.employeeId && can(actor, "helpdesk:agent");
  if (!can(actor, "helpdesk:manage") && !selfAssign) throw new ForbiddenError("Only helpdesk managers can assign tickets to others");
  if (assigneeId) {
    const emp = await db.employee.findUnique({ where: { id: assigneeId }, select: { id: true, status: true } });
    if (!emp || emp.status === "EXITED") throw new NotFoundError("Assignee");
  }
  const updated = await db.ticket.update({ where: { id: ticketId }, data: { assigneeId, ...(t.status === "OPEN" && assigneeId ? { status: "IN_PROGRESS" } : {}) }, include: ticketInclude });
  await audit(actor, "helpdesk.assign", "Ticket", ticketId, { before: { assigneeId: t.assigneeId }, after: { assigneeId } });
  if (assigneeId && assigneeId !== actor.employeeId) await notify({ employeeId: assigneeId, type: "ticket.assigned", title: `Ticket #${t.number} assigned to you`, body: t.subject, link: `/helpdesk/${ticketId}` });
  return serializeTicket(updated);
}

export async function updateTicketStatus(actor: Actor, ticketId: string, status: TicketStatus) {
  const t = await loadTicket(ticketId);
  const v = await canViewTicket(actor, t);
  if (!v.ok) throw new ForbiddenError();
  const isRaiser = actor.employeeId === t.employeeId;
  if (!v.asAgent) {
    // Raisers may close, or reopen their own ticket.
    if (!isRaiser) throw new ForbiddenError();
    if (status !== "CLOSED" && status !== "OPEN") throw new ForbiddenError("You can only close or reopen your own tickets");
  }
  if (status === t.status) return serializeTicket(t);
  const now = new Date();
  const data: Prisma.TicketUpdateInput = { status };
  if (status === "RESOLVED") data.resolvedAt = now;
  if (status === "CLOSED") {
    data.closedAt = now;
    if (!t.resolvedAt) data.resolvedAt = now;
  }
  if (status === "OPEN" || status === "IN_PROGRESS") {
    data.resolvedAt = null;
    data.closedAt = null;
  }
  const updated = await db.ticket.update({ where: { id: ticketId }, data, include: ticketInclude });
  await audit(actor, "helpdesk.status", "Ticket", ticketId, { before: { status: t.status }, after: { status } });
  if (status === "RESOLVED" && !isRaiser) {
    await notify({ employeeId: t.employeeId, type: "ticket.resolved", title: `Ticket #${t.number} resolved`, body: `${t.subject} — reply if the issue persists, or close the ticket.`, link: `/helpdesk/${ticketId}`, email: true });
    dispatchWebhook("ticket.resolved", { id: t.id, number: t.number, category: t.category.name });
  }
  if (status === "OPEN" && isRaiser && t.assigneeId) await notify({ employeeId: t.assigneeId, type: "ticket.reopened", title: `Ticket #${t.number} reopened`, body: t.subject, link: `/helpdesk/${ticketId}` });
  return serializeTicket(updated);
}

export async function updateTicketPriority(actor: Actor, ticketId: string, priority: TicketPriority) {
  const t = await loadTicket(ticketId);
  const v = await canViewTicket(actor, t);
  if (!v.ok || !v.asAgent) throw new ForbiddenError("Only agents can change priority");
  const updated = await db.ticket.update({ where: { id: ticketId }, data: { priority }, include: ticketInclude });
  await audit(actor, "helpdesk.priority", "Ticket", ticketId, { before: { priority: t.priority }, after: { priority } });
  return serializeTicket(updated);
}

/** PATCH helper: applies status / assignee / priority changes in one call. */
export async function updateTicket(actor: Actor, ticketId: string, input: z.infer<typeof updateTicketSchema>) {
  let last: TicketDto | null = null;
  if (input.assigneeId !== undefined) last = await assignTicket(actor, ticketId, input.assigneeId);
  if (input.priority) last = await updateTicketPriority(actor, ticketId, input.priority);
  if (input.status) last = await updateTicketStatus(actor, ticketId, input.status);
  return last ?? serializeTicket(await loadTicket(ticketId));
}

/** Agents (for assignment pickers): employees linked to users with a role that a category routes to. */
export async function listAgents(actor: Actor) {
  if (!isAgent(actor)) throw new ForbiddenError();
  const rows = await db.$queryRaw<{ id: string; displayName: string; roleKey: string; openTickets: number }[]>`
    SELECT DISTINCT ON (e.id, r.key) e.id, e."displayName", r.key AS "roleKey",
           (SELECT COUNT(*) FROM "Ticket" t WHERE t."assigneeId" = e.id AND t.status IN ('OPEN','IN_PROGRESS','WAITING_ON_EMPLOYEE'))::int AS "openTickets"
    FROM "Employee" e
      JOIN "User" u ON u.id = e."userId" AND u.status = 'ACTIVE'
      JOIN "UserRole" ur ON ur."userId" = u.id
      JOIN "Role" r ON r.id = ur."roleId"
      JOIN "RolePermission" rp ON rp."roleId" = r.id AND rp.permission IN ('helpdesk:agent', 'helpdesk:manage')
    WHERE e.status IN ('ACTIVE', 'ON_NOTICE')
    ORDER BY e.id, r.key
    LIMIT 200`;
  const seen = new Map<string, { id: string; displayName: string; roles: string[]; openTickets: number }>();
  for (const r of rows) {
    const a = seen.get(r.id) ?? { id: r.id, displayName: r.displayName, roles: [], openTickets: r.openTickets };
    a.roles.push(r.roleKey);
    seen.set(r.id, a);
  }
  return [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// ── SLA report ─────────────────────────────────────────────────────────

export async function slaReport(actor: Actor) {
  await authorize(actor, "helpdesk:manage");
  const now = new Date();
  const [overdueCount, overdue, avgByCategory, volume, categories, openByAssignee] = await Promise.all([
    db.ticket.count({ where: { status: { in: OPEN_STATUSES }, dueAt: { lt: now } } }),
    db.ticket.findMany({ where: { status: { in: OPEN_STATUSES }, dueAt: { lt: now } }, orderBy: { dueAt: "asc" }, take: 50, include: ticketInclude }),
    db.$queryRaw<{ categoryId: string; name: string; resolved: number; avgHours: number | null; withinSla: number }[]>`
      SELECT c.id AS "categoryId", c.name, COUNT(t.id)::int AS resolved,
             AVG(EXTRACT(EPOCH FROM (t."resolvedAt" - t."createdAt")) / 3600)::float AS "avgHours",
             COUNT(t.id) FILTER (WHERE t."resolvedAt" <= t."dueAt")::int AS "withinSla"
      FROM "TicketCategory" c LEFT JOIN "Ticket" t ON t."categoryId" = c.id AND t."resolvedAt" IS NOT NULL
      GROUP BY c.id, c.name ORDER BY c.name`,
    db.ticket.groupBy({ by: ["categoryId", "status"], _count: { _all: true } }),
    db.ticketCategory.findMany({ select: { id: true, name: true, slaHours: true } }),
    db.$queryRaw<{ assigneeId: string | null; displayName: string | null; open: number }[]>`
      SELECT t."assigneeId", e."displayName", COUNT(*)::int AS open
      FROM "Ticket" t LEFT JOIN "Employee" e ON e.id = t."assigneeId"
      WHERE t.status IN ('OPEN','IN_PROGRESS','WAITING_ON_EMPLOYEE')
      GROUP BY t."assigneeId", e."displayName" ORDER BY open DESC LIMIT 20`,
  ]);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const volumeByCategory = categories.map((c) => {
    const row: Record<string, number | string> = { categoryId: c.id, category: c.name, slaHours: c.slaHours, total: 0 };
    for (const s of STATUSES) row[s] = 0;
    for (const v of volume.filter((x) => x.categoryId === c.id)) {
      row[v.status] = v._count._all;
      row.total = (row.total as number) + v._count._all;
    }
    return row;
  });
  const byStatus: Record<string, number> = {};
  for (const v of volume) byStatus[v.status] = (byStatus[v.status] ?? 0) + v._count._all;
  return {
    generatedAt: now.toISOString(),
    overdueCount,
    openCount: OPEN_STATUSES.reduce((a, s) => a + (byStatus[s] ?? 0), 0),
    byStatus,
    overdue: overdue.map(serializeTicket),
    resolution: avgByCategory.map((r) => ({ ...r, avgHours: r.avgHours === null ? null : Math.round(r.avgHours * 10) / 10, slaPct: r.resolved ? Math.round((r.withinSla / r.resolved) * 100) : null, category: catName.get(r.categoryId) ?? r.name })),
    volumeByCategory,
    openByAssignee: openByAssignee.map((r) => ({ assigneeId: r.assigneeId, name: r.displayName ?? "Unassigned", open: r.open })),
  };
}
