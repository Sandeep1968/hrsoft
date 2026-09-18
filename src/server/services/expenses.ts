import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { Prisma, type ExpenseStatus } from "@/generated/prisma/client";
import { authorize, can, requireEmployee, scopeFilter, type Actor } from "@/lib/rbac/authorize";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { downloadUrl, makeKey, putFile } from "@/lib/storage";
import { paginate, paginationSchema, toPage, zDateOnly, zUuid } from "@/lib/api";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { todayUtc } from "@/lib/dates";

// ───────────────────────────── Schemas ─────────────────────────────

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,19}$/, "Code must be UPPER_SNAKE"),
  maxAmountPerClaim: z.coerce.number().positive().max(100_000_000).optional().nullable(),
  requiresReceipt: z.boolean().default(true),
  glCode: z.string().trim().max(40).optional().nullable(),
  isActive: z.boolean().default(true),
});
export const updateCategorySchema = categorySchema.partial();

export const claimItemSchema = z.object({
  id: zUuid.optional(),
  categoryId: zUuid,
  date: zDateOnly,
  amount: z.coerce.number().positive().max(100_000_000),
  merchant: z.string().trim().max(120).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  receiptKey: z.string().trim().max(300).optional().nullable(),
});
export const createClaimSchema = z.object({
  employeeId: zUuid.optional(),
  title: z.string().trim().min(1).max(120),
  currency: z.string().trim().length(3).default("INR"),
  items: z.array(claimItemSchema).min(1).max(50),
});
export const updateClaimSchema = createClaimSchema.omit({ employeeId: true }).partial();
export const decideSchema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), note: z.string().trim().max(500).optional() });
export const reimburseSchema = z.object({ paymentRef: z.string().trim().max(120).optional(), viaPayroll: z.boolean().default(false) });
export const claimsQuerySchema = paginationSchema.extend({
  status: z.enum(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "REIMBURSED"]).optional(),
  employeeId: zUuid.optional(),
  /** "mine" = my claims; "approve" = claims awaiting my decision; "all" = everything visible. */
  view: z.enum(["mine", "approve", "all"]).optional(),
});

// ───────────────────────────── Helpers ─────────────────────────────

const num = (d: Prisma.Decimal | number | null | undefined) => (d === null || d === undefined ? 0 : Number(d));

const claimInclude = {
  employee: { select: { employeeCode: true, displayName: true, managerId: true, department: { select: { name: true } } } },
  approver: { select: { displayName: true } },
  items: { orderBy: { date: "asc" as const }, include: { category: { select: { name: true, code: true, requiresReceipt: true } } } },
};
type ClaimRow = Prisma.ExpenseClaimGetPayload<{ include: typeof claimInclude }>;

async function serializeClaim(c: ClaimRow, withUrls = false) {
  const items = await Promise.all(
    c.items.map(async (i) => ({
      id: i.id,
      categoryId: i.categoryId,
      categoryName: i.category.name,
      categoryCode: i.category.code,
      requiresReceipt: i.category.requiresReceipt,
      date: i.date.toISOString().slice(0, 10),
      amount: num(i.amount),
      merchant: i.merchant,
      description: i.description,
      receiptKey: i.receiptKey,
      receiptUrl: withUrls && i.receiptKey ? await downloadUrl(i.receiptKey) : null,
    })),
  );
  return {
    id: c.id,
    employeeId: c.employeeId,
    employeeCode: c.employee.employeeCode,
    displayName: c.employee.displayName,
    department: c.employee.department?.name ?? null,
    title: c.title,
    currency: c.currency,
    totalAmount: num(c.totalAmount),
    status: c.status,
    submittedAt: c.submittedAt?.toISOString() ?? null,
    approverId: c.approverId,
    approverName: c.approver?.displayName ?? null,
    decidedAt: c.decidedAt?.toISOString() ?? null,
    decisionNote: c.decisionNote,
    reimbursedAt: c.reimbursedAt?.toISOString() ?? null,
    paymentRef: c.paymentRef,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    itemCount: items.length,
    items,
  };
}
export type ClaimDto = Awaited<ReturnType<typeof serializeClaim>>;

async function loadClaim(id: string): Promise<ClaimRow> {
  const c = await db.expenseClaim.findUnique({ where: { id }, include: claimInclude });
  if (!c) throw new NotFoundError("Expense claim");
  return c;
}

/** Validate items against categories (active, per-claim caps) and return the total. */
async function validateItems(items: z.infer<typeof claimItemSchema>[]) {
  const ids = [...new Set(items.map((i) => i.categoryId))];
  const cats = await db.expenseCategory.findMany({ where: { id: { in: ids } } });
  const byId = new Map(cats.map((c) => [c.id, c]));
  const perCat = new Map<string, number>();
  const today = todayUtc();
  for (const i of items) {
    const c = byId.get(i.categoryId);
    if (!c || !c.isActive) throw new ValidationError("Unknown or inactive expense category");
    if (i.date.getTime() > today.getTime()) throw new ValidationError("Expense date cannot be in the future");
    perCat.set(c.id, (perCat.get(c.id) ?? 0) + i.amount);
  }
  for (const [id, sum] of perCat) {
    const c = byId.get(id)!;
    if (c.maxAmountPerClaim !== null && sum > num(c.maxAmountPerClaim)) {
      throw new ValidationError(`${c.name} is capped at ${num(c.maxAmountPerClaim)} per claim (you claimed ${sum})`);
    }
  }
  return { total: Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100, categories: byId };
}

// ───────────────────────────── Categories ─────────────────────────────

export async function listCategories(actor: Actor, opts: { includeInactive?: boolean } = {}) {
  if (!can(actor, "expenses:read") && !can(actor, "expenses:submit") && !can(actor, "expenses:manage")) throw new ForbiddenError("Missing permission expenses:read");
  const rows = await db.expenseCategory.findMany({ where: opts.includeInactive ? {} : { isActive: true }, orderBy: { name: "asc" } });
  return rows.map((c) => ({ ...c, maxAmountPerClaim: c.maxAmountPerClaim === null ? null : num(c.maxAmountPerClaim) }));
}

export async function createCategory(actor: Actor, input: z.infer<typeof categorySchema>) {
  await authorize(actor, "expenses:manage");
  if (await db.expenseCategory.findUnique({ where: { code: input.code } })) throw new ConflictError(`Category ${input.code} already exists`);
  const c = await db.expenseCategory.create({ data: { ...input, maxAmountPerClaim: input.maxAmountPerClaim ?? null, glCode: input.glCode ?? null } });
  await audit(actor, "expenses.category.create", "ExpenseCategory", c.id, { after: input });
  return { ...c, maxAmountPerClaim: c.maxAmountPerClaim === null ? null : num(c.maxAmountPerClaim) };
}

export async function updateCategory(actor: Actor, id: string, input: z.infer<typeof updateCategorySchema>) {
  await authorize(actor, "expenses:manage");
  const before = await db.expenseCategory.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Expense category");
  const c = await db.expenseCategory.update({ where: { id }, data: { ...input, maxAmountPerClaim: input.maxAmountPerClaim === undefined ? undefined : input.maxAmountPerClaim } });
  await audit(actor, "expenses.category.update", "ExpenseCategory", id, { before, after: input });
  return { ...c, maxAmountPerClaim: c.maxAmountPerClaim === null ? null : num(c.maxAmountPerClaim) };
}

export async function deleteCategory(actor: Actor, id: string) {
  await authorize(actor, "expenses:manage");
  const before = await db.expenseCategory.findUnique({ where: { id }, include: { _count: { select: { items: true } } } });
  if (!before) throw new NotFoundError("Expense category");
  if (before._count.items > 0) {
    await db.expenseCategory.update({ where: { id }, data: { isActive: false } });
    await audit(actor, "expenses.category.deactivate", "ExpenseCategory", id, { before });
    return { deactivated: true };
  }
  await db.expenseCategory.delete({ where: { id } });
  await audit(actor, "expenses.category.delete", "ExpenseCategory", id, { before });
  return { deleted: true };
}

// ───────────────────────────── Claims ─────────────────────────────

export async function createClaim(actor: Actor, input: z.infer<typeof createClaimSchema>) {
  const employeeId = input.employeeId ?? requireEmployee(actor);
  await authorize(actor, "expenses:submit", { employeeId });
  const { total } = await validateItems(input.items);
  const c = await db.expenseClaim.create({
    data: {
      employeeId,
      title: input.title,
      currency: input.currency,
      totalAmount: total,
      status: "DRAFT",
      items: { create: input.items.map((i) => ({ categoryId: i.categoryId, date: i.date, amount: i.amount, merchant: i.merchant ?? null, description: i.description ?? null, receiptKey: i.receiptKey ?? null })) },
    },
    include: claimInclude,
  });
  await audit(actor, "expenses.claim.create", "ExpenseClaim", c.id, { after: { title: input.title, total, items: input.items.length } });
  return serializeClaim(c);
}

export async function updateClaim(actor: Actor, id: string, input: z.infer<typeof updateClaimSchema>) {
  const c = await loadClaim(id);
  await authorize(actor, "expenses:submit", { employeeId: c.employeeId });
  if (c.status !== "DRAFT") throw new ConflictError("Only draft claims can be edited");
  let total = num(c.totalAmount);
  if (input.items) ({ total } = await validateItems(input.items));
  const updated = await db.$transaction(async (tx) => {
    if (input.items) {
      const keep = new Set(input.items.map((i) => i.id).filter((x): x is string => Boolean(x)));
      await tx.expenseItem.deleteMany({ where: { claimId: id, ...(keep.size ? { id: { notIn: [...keep] } } : {}) } });
      for (const i of input.items) {
        const data = { categoryId: i.categoryId, date: i.date, amount: i.amount, merchant: i.merchant ?? null, description: i.description ?? null };
        if (i.id && keep.has(i.id)) await tx.expenseItem.update({ where: { id: i.id }, data: { ...data, ...(i.receiptKey !== undefined ? { receiptKey: i.receiptKey } : {}) } });
        else await tx.expenseItem.create({ data: { ...data, claimId: id, receiptKey: i.receiptKey ?? null } });
      }
    }
    return tx.expenseClaim.update({ where: { id }, data: { title: input.title, currency: input.currency, totalAmount: total }, include: claimInclude });
  });
  await audit(actor, "expenses.claim.update", "ExpenseClaim", id, { before: { title: c.title, total: num(c.totalAmount) }, after: { title: updated.title, total } });
  return serializeClaim(updated);
}

export async function deleteClaim(actor: Actor, id: string) {
  const c = await loadClaim(id);
  await authorize(actor, "expenses:submit", { employeeId: c.employeeId });
  if (c.status !== "DRAFT") throw new ConflictError("Only draft claims can be deleted");
  await db.expenseClaim.delete({ where: { id } });
  await audit(actor, "expenses.claim.delete", "ExpenseClaim", id, { before: { title: c.title, total: num(c.totalAmount) } });
  return { deleted: true };
}

export interface UploadFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** Store a receipt and attach it to an item of a draft claim. */
export async function uploadReceipt(actor: Actor, claimId: string, itemId: string, file: UploadFile) {
  const c = await loadClaim(claimId);
  await authorize(actor, "expenses:submit", { employeeId: c.employeeId });
  if (c.status !== "DRAFT" && c.status !== "SUBMITTED") throw new ConflictError("Receipts can only be added before approval");
  const item = c.items.find((i) => i.id === itemId);
  if (!item) throw new NotFoundError("Expense item");
  let stored;
  try {
    stored = await putFile(makeKey("receipts", file.name), file.buffer, file.mimeType);
  } catch (e) {
    throw new ValidationError(e instanceof Error ? e.message : "Upload failed");
  }
  await db.expenseItem.update({ where: { id: itemId }, data: { receiptKey: stored.key } });
  await audit(actor, "expenses.claim.receipt", "ExpenseClaim", claimId, { after: { itemId, key: stored.key, size: stored.size } });
  return { itemId, receiptKey: stored.key, url: await downloadUrl(stored.key) };
}

export async function submitClaim(actor: Actor, id: string) {
  const c = await loadClaim(id);
  await authorize(actor, "expenses:submit", { employeeId: c.employeeId });
  if (c.status !== "DRAFT" && c.status !== "REJECTED") throw new ConflictError(`Claim is already ${c.status}`);
  if (c.items.length === 0) throw new ValidationError("Add at least one expense item");
  const missing = c.items.filter((i) => i.category.requiresReceipt && !i.receiptKey);
  if (missing.length) throw new ValidationError(`Receipt required for: ${missing.map((i) => `${i.category.name} (${i.date.toISOString().slice(0, 10)})`).join(", ")}`);
  const approverId = c.employee.managerId;
  const updated = await db.expenseClaim.update({ where: { id }, data: { status: "SUBMITTED", submittedAt: new Date(), approverId, decidedAt: null, decisionNote: null }, include: claimInclude });
  await audit(actor, "expenses.claim.submit", "ExpenseClaim", id, { before: { status: c.status }, after: { status: "SUBMITTED", approverId } });
  if (approverId) {
    await notify({
      employeeId: approverId,
      type: "expenses.approval",
      title: `Expense claim from ${c.employee.displayName} awaits your approval`,
      body: `${c.title} · ${c.currency} ${num(c.totalAmount).toLocaleString("en-IN")}`,
      link: `/expenses/${id}`,
      email: true,
    });
  }
  return serializeClaim(updated);
}

/** Owner pulls back a submitted claim (before a decision). */
export async function withdrawClaim(actor: Actor, id: string) {
  const c = await loadClaim(id);
  await authorize(actor, "expenses:submit", { employeeId: c.employeeId });
  if (c.status !== "SUBMITTED") throw new ConflictError("Only submitted claims can be withdrawn");
  const updated = await db.expenseClaim.update({ where: { id }, data: { status: "DRAFT", submittedAt: null, approverId: null }, include: claimInclude });
  await audit(actor, "expenses.claim.withdraw", "ExpenseClaim", id, { before: { status: "SUBMITTED" }, after: { status: "DRAFT" } });
  return serializeClaim(updated);
}

export async function listClaims(actor: Actor, p: z.infer<typeof claimsQuerySchema>) {
  const NONE = "00000000-0000-0000-0000-000000000000";
  let where: Prisma.ExpenseClaimWhereInput;
  if (p.view === "approve") {
    // Approver queue: claims explicitly routed to me (or every submitted claim for ALL-scope approvers).
    if (!can(actor, "expenses:approve")) throw new ForbiddenError("Missing permission expenses:approve");
    where = { status: "SUBMITTED", ...(can(actor, "expenses:approve", "ALL") ? {} : { approverId: actor.employeeId ?? NONE }) };
  } else {
    where = { ...(await scopeFilter(actor, "expenses:read")) };
    if (p.view === "mine") where.employeeId = actor.employeeId ?? NONE;
  }
  if (p.employeeId) where.employeeId = p.employeeId;
  if (p.status && p.view !== "approve") where.status = p.status;
  if (p.q) where.OR = [{ title: { contains: p.q, mode: "insensitive" } }, { employee: { displayName: { contains: p.q, mode: "insensitive" } } }];
  const [rows, total] = await Promise.all([
    db.expenseClaim.findMany({ where, orderBy: p.sort === "amount" ? { totalAmount: p.order } : { createdAt: "desc" }, ...paginate(p), include: claimInclude }),
    db.expenseClaim.count({ where }),
  ]);
  return toPage(await Promise.all(rows.map((r) => serializeClaim(r))), total, p);
}

export async function getClaim(actor: Actor, id: string) {
  const c = await loadClaim(id);
  const isApprover = c.approverId !== null && c.approverId === actor.employeeId;
  if (!isApprover) await authorize(actor, "expenses:read", { employeeId: c.employeeId });
  return serializeClaim(c, true);
}

export async function decideClaim(actor: Actor, id: string, input: z.infer<typeof decideSchema>) {
  const c = await loadClaim(id);
  const scope = await authorize(actor, "expenses:approve", { employeeId: c.employeeId });
  if (scope !== "ALL" && actor.employeeId === c.employeeId) throw new ForbiddenError("You cannot approve your own expense claim");
  if (c.status !== "SUBMITTED") throw new ConflictError(`Claim is ${c.status}, not awaiting approval`);
  const updated = await db.expenseClaim.update({
    where: { id },
    data: { status: input.decision as ExpenseStatus, decidedAt: new Date(), decisionNote: input.note ?? null, approverId: c.approverId ?? actor.employeeId },
    include: claimInclude,
  });
  await audit(actor, "expenses.claim.decide", "ExpenseClaim", id, { before: { status: c.status }, after: { status: input.decision, note: input.note } });
  await notify({
    employeeId: c.employeeId,
    type: "expenses.decision",
    title: `Your expense claim "${c.title}" was ${input.decision.toLowerCase()}`,
    body: input.note ?? undefined,
    link: `/expenses/${id}`,
    email: true,
  });
  return serializeClaim(updated);
}

/** First payroll month (from today) for which the employee's entity has no finalised run. */
async function nextOpenPayrollMonth(employeeId: string): Promise<{ month: number; year: number }> {
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { legalEntityId: true } });
  const today = todayUtc();
  let month = today.getUTCMonth() + 1;
  let year = today.getUTCFullYear();
  for (let i = 0; i < 12; i++) {
    const run = emp?.legalEntityId
      ? await db.payrollRun.findUnique({ where: { legalEntityId_month_year: { legalEntityId: emp.legalEntityId, month, year } }, select: { status: true } })
      : null;
    if (!run || (run.status !== "FINALIZED" && run.status !== "PAID")) return { month, year };
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return { month, year };
}

export async function reimburseClaim(actor: Actor, id: string, input: z.infer<typeof reimburseSchema>) {
  await authorize(actor, "expenses:reimburse");
  const c = await loadClaim(id);
  if (c.status !== "APPROVED") throw new ConflictError(`Only approved claims can be reimbursed (current: ${c.status})`);
  let adjustmentId: string | null = null;
  const updated = await db.$transaction(async (tx) => {
    if (input.viaPayroll) {
      const { month, year } = await nextOpenPayrollMonth(c.employeeId);
      const adj = await tx.payrollAdjustment.create({
        data: { employeeId: c.employeeId, month, year, type: "EARNING", code: "REIMB", label: `Expense reimbursement: ${c.title}`.slice(0, 80), amount: c.totalAmount, isTaxable: false, reason: `Expense claim ${c.id}`, createdById: actor.userId },
      });
      adjustmentId = adj.id;
    }
    return tx.expenseClaim.update({
      where: { id },
      data: { status: "REIMBURSED", reimbursedAt: new Date(), paymentRef: input.viaPayroll ? `PAYROLL:${adjustmentId}` : (input.paymentRef ?? null) },
      include: claimInclude,
    });
  });
  await audit(actor, "expenses.claim.reimburse", "ExpenseClaim", id, { before: { status: c.status }, after: { status: "REIMBURSED", paymentRef: updated.paymentRef, viaPayroll: input.viaPayroll } });
  await notify({
    employeeId: c.employeeId,
    type: "expenses.reimbursed",
    title: `Expense claim "${c.title}" reimbursed`,
    body: input.viaPayroll ? "The amount will be paid with your next salary." : `Payment reference: ${input.paymentRef ?? "—"}`,
    link: `/expenses/${id}`,
    email: true,
  });
  return serializeClaim(updated);
}

// ───────────────────────────── Finance summary ─────────────────────────────

export async function expenseSummary(actor: Actor) {
  if (!can(actor, "expenses:reimburse") && !can(actor, "expenses:read", "ALL")) throw new ForbiddenError("Missing permission expenses:reimburse");
  const [byCategory, byMonth, pending] = await Promise.all([
    db.$queryRaw<{ category: string; code: string; claims: number; amount: number }[]>`
      SELECT c.name AS category, c.code AS code, COUNT(DISTINCT i."claimId")::int AS claims, COALESCE(SUM(i.amount), 0)::float AS amount
      FROM "ExpenseItem" i
      JOIN "ExpenseCategory" c ON c.id = i."categoryId"
      JOIN "ExpenseClaim" e ON e.id = i."claimId"
      WHERE e.status IN ('APPROVED', 'REIMBURSED') AND e."createdAt" >= NOW() - INTERVAL '12 months'
      GROUP BY 1, 2 ORDER BY 4 DESC`,
    db.$queryRaw<{ month: string; submitted: number; approved: number; reimbursed: number }[]>`
      SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month,
             COALESCE(SUM(CASE WHEN status = 'SUBMITTED' THEN "totalAmount" END), 0)::float AS submitted,
             COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN "totalAmount" END), 0)::float AS approved,
             COALESCE(SUM(CASE WHEN status = 'REIMBURSED' THEN "totalAmount" END), 0)::float AS reimbursed
      FROM "ExpenseClaim"
      WHERE "createdAt" >= date_trunc('month', NOW()) - INTERVAL '11 months'
      GROUP BY 1 ORDER BY 1`,
    db.expenseClaim.groupBy({ by: ["status"], where: { status: { in: ["SUBMITTED", "APPROVED"] } }, _count: { _all: true }, _sum: { totalAmount: true } }),
  ]);
  const p = (s: ExpenseStatus) => {
    const row = pending.find((r) => r.status === s);
    return { count: row?._count._all ?? 0, amount: num(row?._sum.totalAmount) };
  };
  return { byCategory, byMonth, awaitingApproval: p("SUBMITTED"), awaitingReimbursement: p("APPROVED") };
}
export type ExpenseSummary = Awaited<ReturnType<typeof expenseSummary>>;
