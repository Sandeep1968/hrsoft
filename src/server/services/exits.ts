import "server-only";
import { z } from "zod";
import { Prisma, type RequestStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { isoDate, toDateOnly, todayUtc } from "@/lib/dates";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { zDateOnly } from "@/lib/api";
import { type Actor, authorize, can, requireEmployee } from "@/lib/rbac/authorize";

export const requestExitSchema = z.object({
  resignationDate: zDateOnly,
  lastWorkingDay: zDateOnly,
  reason: z.string().trim().min(3).max(2000),
});
export const decideExitSchema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), note: z.string().trim().max(2000).optional() });
export const clearanceSchema = z.object({
  it: z.boolean().optional(),
  finance: z.boolean().optional(),
  hr: z.boolean().optional(),
  manager: z.boolean().optional(),
  notes: z.string().trim().max(4000).optional(),
  exitInterview: z.string().trim().max(8000).optional(),
});
export type Clearance = { it: boolean; finance: boolean; hr: boolean; manager: boolean; notes: string };

export interface ExitRequestDto {
  id: string;
  employeeId: string;
  employee: { displayName: string; employeeCode: string; department: string | null; designation: string | null; manager: string | null };
  resignationDate: string;
  lastWorkingDay: string;
  reason: string;
  status: RequestStatus;
  approverId: string | null;
  approver: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  clearance: Clearance;
  exitInterview: string | null;
  createdAt: string;
}

const include = {
  employee: { select: { displayName: true, employeeCode: true, department: { select: { name: true } }, designation: { select: { name: true } }, manager: { select: { displayName: true } } } },
} as const;
type Row = Prisma.ExitRequestGetPayload<{ include: typeof include }>;

function normalizeClearance(c: unknown): Clearance {
  const o = (c && typeof c === "object" ? c : {}) as Partial<Clearance>;
  return { it: Boolean(o.it), finance: Boolean(o.finance), hr: Boolean(o.hr), manager: Boolean(o.manager), notes: typeof o.notes === "string" ? o.notes : "" };
}

async function toDto(r: Row): Promise<ExitRequestDto> {
  const approver = r.approverId ? await db.employee.findUnique({ where: { id: r.approverId }, select: { displayName: true } }) : null;
  return {
    id: r.id,
    employeeId: r.employeeId,
    employee: { displayName: r.employee.displayName, employeeCode: r.employee.employeeCode, department: r.employee.department?.name ?? null, designation: r.employee.designation?.name ?? null, manager: r.employee.manager?.displayName ?? null },
    resignationDate: isoDate(r.resignationDate),
    lastWorkingDay: isoDate(r.lastWorkingDay),
    reason: r.reason,
    status: r.status,
    approverId: r.approverId,
    approver: approver?.displayName ?? null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    clearance: normalizeClearance(r.clearance),
    exitInterview: r.exitInterview,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Self-service resignation. */
export async function requestExit(actor: Actor, input: z.infer<typeof requestExitSchema>) {
  const employeeId = requireEmployee(actor);
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { status: true, managerId: true, displayName: true, noticePeriodDays: true } });
  if (!emp) throw new NotFoundError("Employee");
  if (emp.status === "EXITED" || emp.status === "ON_NOTICE") throw new ConflictError("An exit is already in progress for you");
  if (input.lastWorkingDay.getTime() < input.resignationDate.getTime()) throw new ValidationError("Last working day must be on or after the resignation date");
  if (await db.exitRequest.findFirst({ where: { employeeId, status: "PENDING" }, select: { id: true } })) throw new ConflictError("You already have a pending resignation");
  const row = await db.exitRequest.create({
    data: { employeeId, resignationDate: input.resignationDate, lastWorkingDay: input.lastWorkingDay, reason: input.reason, approverId: emp.managerId, clearance: {} },
    include,
  });
  await audit(actor, "exits.request", "ExitRequest", row.id, { after: { ...input, resignationDate: isoDate(input.resignationDate), lastWorkingDay: isoDate(input.lastWorkingDay) } });
  if (emp.managerId) await notify({ employeeId: emp.managerId, type: "exits", title: `${emp.displayName} has submitted a resignation`, body: `Proposed last working day: ${isoDate(input.lastWorkingDay)}`, link: "/exits", email: true });
  const hr = await db.user.findMany({ where: { roles: { some: { role: { key: "HR_ADMIN" } } }, status: "ACTIVE" }, select: { id: true }, take: 5 });
  await Promise.all(hr.map((u) => notify({ userId: u.id, type: "exits", title: `Resignation: ${emp.displayName}`, body: `Proposed last working day ${isoDate(input.lastWorkingDay)}.`, link: `/exits` })));
  return toDto(row);
}

/** HR sees everything (optionally filtered by status); everyone else sees their own requests. */
export async function listExits(actor: Actor, params: { status?: RequestStatus; employeeId?: string; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));
  let where: Prisma.ExitRequestWhereInput;
  if (can(actor, "exits:manage")) where = { ...(params.status ? { status: params.status } : {}), ...(params.employeeId ? { employeeId: params.employeeId } : {}) };
  else if (actor.employeeId) where = { employeeId: actor.employeeId, ...(params.status ? { status: params.status } : {}) };
  else return { items: [] as ExitRequestDto[], total: 0, page, pageSize, pages: 1 };
  const [rows, total] = await Promise.all([
    db.exitRequest.findMany({ where, include, orderBy: [{ status: "asc" }, { createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    db.exitRequest.count({ where }),
  ]);
  const items = await Promise.all(rows.map(toDto));
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getExit(actor: Actor, id: string) {
  const row = await db.exitRequest.findUnique({ where: { id }, include });
  if (!row) throw new NotFoundError("Exit request");
  if (!can(actor, "exits:manage") && actor.employeeId !== row.employeeId) throw new ForbiddenError();
  return toDto(row);
}

/** Approval contract: POST /api/v1/exit-requests/:id/decide { decision, note }. Requires `exits:manage`. */
export async function decideExit(actor: Actor, id: string, decision: "APPROVED" | "REJECTED", note?: string) {
  await authorize(actor, "exits:manage");
  const row = await db.exitRequest.findUnique({ where: { id }, include });
  if (!row) throw new NotFoundError("Exit request");
  if (row.status !== "PENDING") throw new ConflictError(`Request is already ${row.status.toLowerCase()}`);
  if (actor.employeeId === row.employeeId && !can(actor, "exits:manage", "ALL")) throw new ForbiddenError("You cannot decide your own exit request");
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.exitRequest.update({
      where: { id },
      data: { status: decision, decidedAt: new Date(), decisionNote: note ?? null, approverId: actor.employeeId ?? row.approverId },
      include,
    });
    if (decision === "APPROVED") {
      await tx.employee.update({ where: { id: row.employeeId }, data: { status: "ON_NOTICE", exitDate: row.lastWorkingDay, exitReason: row.reason } });
      await tx.jobHistory.create({ data: { employeeId: row.employeeId, effectiveFrom: toDateOnly(row.resignationDate), reason: "Resignation accepted", note: `Last working day ${isoDate(row.lastWorkingDay)}` } });
    }
    return u;
  });
  await audit(actor, `exits.${decision.toLowerCase()}`, "ExitRequest", id, { before: { status: row.status }, after: { status: decision, note } });
  await notify({ employeeId: row.employeeId, type: "exits", title: decision === "APPROVED" ? "Your resignation has been accepted" : "Your resignation was not accepted", body: note ?? (decision === "APPROVED" ? `Last working day: ${isoDate(row.lastWorkingDay)}` : undefined), link: "/me?tab=job", email: true });
  return toDto(updated);
}

export async function updateClearance(actor: Actor, id: string, input: z.infer<typeof clearanceSchema>) {
  await authorize(actor, "exits:manage");
  const row = await db.exitRequest.findUnique({ where: { id }, include });
  if (!row) throw new NotFoundError("Exit request");
  if (row.status !== "APPROVED") throw new ConflictError("Clearance can only be tracked on approved exits");
  const before = normalizeClearance(row.clearance);
  const { exitInterview, ...c } = input;
  const clearance: Clearance = { ...before, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) } as Clearance;
  const allClear = clearance.it && clearance.finance && clearance.hr && clearance.manager;
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.exitRequest.update({ where: { id }, data: { clearance: clearance as unknown as Prisma.InputJsonObject, ...(exitInterview !== undefined ? { exitInterview } : {}) }, include });
    // When every clearance is done and the last working day has passed, finalise the exit.
    if (allClear && row.lastWorkingDay.getTime() <= todayUtc().getTime()) {
      const emp = await tx.employee.update({ where: { id: row.employeeId }, data: { status: "EXITED" }, select: { userId: true } });
      if (emp.userId) {
        await tx.user.update({ where: { id: emp.userId }, data: { status: "SUSPENDED" } });
        await tx.session.deleteMany({ where: { userId: emp.userId } });
      }
    }
    return u;
  });
  await audit(actor, "exits.clearance", "ExitRequest", id, { before, after: clearance });
  return toDto(updated);
}

/** Employee withdraws their own pending resignation. */
export async function cancelExit(actor: Actor, id: string) {
  const row = await db.exitRequest.findUnique({ where: { id }, include });
  if (!row) throw new NotFoundError("Exit request");
  if (actor.employeeId !== row.employeeId && !can(actor, "exits:manage")) throw new ForbiddenError();
  if (row.status !== "PENDING") throw new ConflictError("Only pending requests can be withdrawn");
  const updated = await db.exitRequest.update({ where: { id }, data: { status: "CANCELLED", decidedAt: new Date() }, include });
  await audit(actor, "exits.cancel", "ExitRequest", id, { before: { status: row.status }, after: { status: "CANCELLED" } });
  return toDto(updated);
}
