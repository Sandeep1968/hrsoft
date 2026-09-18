import "server-only";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { Prisma, type PayrollRunStatus, type DeclarationStatus } from "@/generated/prisma/client";
import { authorize, can, requireEmployee, type Actor } from "@/lib/rbac/authorize";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { decryptField, mask } from "@/lib/crypto";
import { paginate, paginationSchema, toPage, zDateOnly, zUuid, type Pagination } from "@/lib/api";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { financialYear, monthRange, todayUtc } from "@/lib/dates";
import {
  amountInWords,
  computeAnnualTax,
  computeMonthlyStructure,
  computePayslip,
  computeProfessionalTax,
  fyMonthsBefore,
  fyOf,
  monthIndexInFy,
  type AdjustmentLike,
  type ComponentLike,
  type DeclarationKey,
  type Regime,
  type StatutoryConfig,
} from "@/server/payroll/engine";

// ───────────────────────────── Schemas ─────────────────────────────

const zCode = z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,19}$/, "Code must be UPPER_SNAKE (2-20 chars)");

export const componentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: zCode,
  type: z.enum(["EARNING", "DEDUCTION", "EMPLOYER_CONTRIBUTION", "REIMBURSEMENT"]),
  isTaxable: z.boolean().default(true),
  isStatutory: z.boolean().default(false),
  isPartOfCtc: z.boolean().default(true),
  isProrated: z.boolean().default(true),
  showInPayslip: z.boolean().default(true),
  order: z.coerce.number().int().min(0).max(999).default(0),
  isActive: z.boolean().default(true),
});
export const updateComponentSchema = componentSchema.partial();

export const structureLineSchema = z.object({
  componentId: zUuid,
  calcType: z.enum(["FIXED", "PERCENT_OF_BASIC", "PERCENT_OF_GROSS", "PERCENT_OF_CTC", "BALANCE"]),
  value: z.coerce.number().min(0).max(100_000_000).default(0),
  order: z.coerce.number().int().min(0).default(0),
});
export const structureSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional().nullable(),
  isDefault: z.boolean().default(false),
  lines: z.array(structureLineSchema).min(1).max(40),
});
export const updateStructureSchema = structureSchema.partial();

export const previewStructureSchema = z.object({
  structureId: zUuid.optional(),
  lines: z.array(structureLineSchema).optional(),
  annualCtc: z.coerce.number().positive().max(1_000_000_000),
});

export const assignSalarySchema = z.object({
  employeeId: zUuid,
  structureId: zUuid,
  annualCtc: z.coerce.number().positive().max(1_000_000_000),
  effectiveFrom: zDateOnly,
  pfApplicable: z.boolean().default(true),
  esiApplicable: z.boolean().default(false),
  ptApplicable: z.boolean().default(true),
  taxRegime: z.enum(["NEW", "OLD"]).default("NEW"),
  note: z.string().trim().max(300).optional(),
});

export const salariesQuerySchema = paginationSchema.extend({ departmentId: zUuid.optional() });

export const createRunSchema = z.object({
  legalEntityId: zUuid.optional(),
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  notes: z.string().trim().max(500).optional(),
});
export const runsQuerySchema = paginationSchema.extend({
  year: z.coerce.number().int().optional(),
  status: z.enum(["DRAFT", "PROCESSING", "REVIEW", "FINALIZED", "PAID"]).optional(),
});
export const markPaidSchema = z.object({ paymentRef: z.string().trim().min(1).max(120), paidAt: z.coerce.date().optional() });

export const adjustmentSchema = z.object({
  employeeId: zUuid,
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  type: z.enum(["EARNING", "DEDUCTION"]),
  code: zCode,
  label: z.string().trim().min(1).max(80),
  amount: z.coerce.number().positive().max(100_000_000),
  isTaxable: z.boolean().default(true),
  reason: z.string().trim().max(300).optional(),
});
export const adjustmentsQuerySchema = paginationSchema.extend({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().optional(),
  employeeId: zUuid.optional(),
  runId: zUuid.optional(),
});

export const payslipsQuerySchema = paginationSchema.extend({ employeeId: zUuid.optional(), year: z.coerce.number().int().optional() });

const DECLARATION_KEYS: DeclarationKey[] = ["80C", "80D", "80CCD1B", "80CCD2", "HRA_EXEMPT", "24B", "80G", "80TTA"];
export const declarationSchema = z.object({
  employeeId: zUuid.optional(),
  financialYear: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  regime: z.enum(["NEW", "OLD"]),
  declarations: z.record(z.string(), z.coerce.number().min(0).max(100_000_000)).default({}),
});
export const verifyDeclarationSchema = z.object({ decision: z.enum(["VERIFIED", "REJECTED"]), note: z.string().trim().max(500).optional() });
export const declarationsQuerySchema = paginationSchema.extend({
  fy: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  status: z.enum(["DRAFT", "SUBMITTED", "VERIFIED", "REJECTED"]).optional(),
});

// ───────────────────────────── Helpers ─────────────────────────────

const num = (d: Prisma.Decimal | number | string | null | undefined) => (d === null || d === undefined ? 0 : Number(d));
const jsonNum = (j: Prisma.JsonValue | null | undefined): Record<string, number> => {
  if (!j || typeof j !== "object" || Array.isArray(j)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(j)) out[k] = Number(v) || 0;
  return out;
};

const CHUNK = 200;
const RUN_READ = (actor: Actor) => can(actor, "payroll:run") || can(actor, "payroll:read", "ALL");

function csv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

async function defaultEntityId(): Promise<string> {
  const e = (await db.legalEntity.findFirst({ where: { isDefault: true }, select: { id: true } })) ?? (await db.legalEntity.findFirst({ select: { id: true } }));
  if (!e) throw new ValidationError("No legal entity configured");
  return e.id;
}

async function componentMap(): Promise<Map<string, ComponentLike & { id: string; name: string; order: number; showInPayslip: boolean }>> {
  const rows = await db.salaryComponent.findMany({ orderBy: { order: "asc" } });
  return new Map(rows.map((c) => [c.code, { ...c }]));
}

function serializeSalary(s: {
  id: string;
  employeeId: string;
  structureId: string | null;
  effectiveFrom: Date;
  annualCtc: Prisma.Decimal;
  monthly: Prisma.JsonValue;
  pfApplicable: boolean;
  esiApplicable: boolean;
  ptApplicable: boolean;
  taxRegime: string;
  isCurrent: boolean;
  createdAt: Date;
  structure?: { name: string } | null;
}) {
  return {
    id: s.id,
    employeeId: s.employeeId,
    structureId: s.structureId,
    structureName: s.structure?.name ?? null,
    effectiveFrom: s.effectiveFrom.toISOString().slice(0, 10),
    annualCtc: num(s.annualCtc),
    monthly: jsonNum(s.monthly),
    pfApplicable: s.pfApplicable,
    esiApplicable: s.esiApplicable,
    ptApplicable: s.ptApplicable,
    taxRegime: s.taxRegime as Regime,
    isCurrent: s.isCurrent,
    createdAt: s.createdAt.toISOString(),
  };
}
export type SalaryDto = ReturnType<typeof serializeSalary>;

type RunRow = {
  id: string;
  legalEntityId: string;
  month: number;
  year: number;
  status: PayrollRunStatus;
  employeeCount: number;
  processedCount: number;
  totalGross: Prisma.Decimal;
  totalDeductions: Prisma.Decimal;
  totalNet: Prisma.Decimal;
  totalEmployerCost: Prisma.Decimal;
  finalizedAt: Date | null;
  paidAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  legalEntity?: { name: string; ptState: string | null };
};
function serializeRun(r: RunRow) {
  return {
    id: r.id,
    legalEntityId: r.legalEntityId,
    legalEntityName: r.legalEntity?.name ?? null,
    ptState: r.legalEntity?.ptState ?? null,
    month: r.month,
    year: r.year,
    status: r.status,
    employeeCount: r.employeeCount,
    processedCount: r.processedCount,
    totalGross: num(r.totalGross),
    totalDeductions: num(r.totalDeductions),
    totalNet: num(r.totalNet),
    totalEmployerCost: num(r.totalEmployerCost),
    finalizedAt: r.finalizedAt?.toISOString() ?? null,
    paidAt: r.paidAt?.toISOString() ?? null,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
export type RunDto = ReturnType<typeof serializeRun>;

type PayslipRow = {
  id: string;
  runId: string;
  employeeId: string;
  month: number;
  year: number;
  workingDays: Prisma.Decimal;
  payableDays: Prisma.Decimal;
  lopDays: Prisma.Decimal;
  earnings: Prisma.JsonValue;
  deductions: Prisma.JsonValue;
  employerContributions: Prisma.JsonValue;
  gross: Prisma.Decimal;
  totalDeductions: Prisma.Decimal;
  netPay: Prisma.Decimal;
  employerCost: Prisma.Decimal;
  pfEmployee: Prisma.Decimal;
  pfEmployer: Prisma.Decimal;
  esiEmployee: Prisma.Decimal;
  esiEmployer: Prisma.Decimal;
  professionalTax: Prisma.Decimal;
  tds: Prisma.Decimal;
  paymentRef: string | null;
  paidAt: Date | null;
  createdAt: Date;
};
function serializePayslip(p: PayslipRow) {
  return {
    id: p.id,
    runId: p.runId,
    employeeId: p.employeeId,
    month: p.month,
    year: p.year,
    workingDays: num(p.workingDays),
    payableDays: num(p.payableDays),
    lopDays: num(p.lopDays),
    earnings: jsonNum(p.earnings),
    deductions: jsonNum(p.deductions),
    employerContributions: jsonNum(p.employerContributions),
    gross: num(p.gross),
    totalDeductions: num(p.totalDeductions),
    netPay: num(p.netPay),
    employerCost: num(p.employerCost),
    pfEmployee: num(p.pfEmployee),
    pfEmployer: num(p.pfEmployer),
    esiEmployee: num(p.esiEmployee),
    esiEmployer: num(p.esiEmployer),
    professionalTax: num(p.professionalTax),
    tds: num(p.tds),
    paymentRef: p.paymentRef,
    paidAt: p.paidAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}
export type PayslipDto = ReturnType<typeof serializePayslip>;

// ───────────────────────────── Components ─────────────────────────────

export async function listComponents(actor: Actor, opts: { includeInactive?: boolean } = {}) {
  await authorize(actor, "payroll:read");
  return db.salaryComponent.findMany({ where: opts.includeInactive ? {} : { isActive: true }, orderBy: [{ order: "asc" }, { code: "asc" }] });
}

export async function createComponent(actor: Actor, input: z.infer<typeof componentSchema>) {
  await authorize(actor, "payroll:manage");
  const existing = await db.salaryComponent.findUnique({ where: { code: input.code } });
  if (existing) throw new ConflictError(`Component code ${input.code} already exists`);
  const c = await db.salaryComponent.create({ data: input });
  await audit(actor, "payroll.component.create", "SalaryComponent", c.id, { after: c });
  return c;
}

export async function updateComponent(actor: Actor, id: string, input: z.infer<typeof updateComponentSchema>) {
  await authorize(actor, "payroll:manage");
  const before = await db.salaryComponent.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Salary component");
  if (input.code && input.code !== before.code) {
    const dup = await db.salaryComponent.findUnique({ where: { code: input.code } });
    if (dup) throw new ConflictError(`Component code ${input.code} already exists`);
  }
  const after = await db.salaryComponent.update({ where: { id }, data: input });
  await audit(actor, "payroll.component.update", "SalaryComponent", id, { before, after });
  return after;
}

export async function deleteComponent(actor: Actor, id: string) {
  await authorize(actor, "payroll:manage");
  const before = await db.salaryComponent.findUnique({ where: { id }, include: { _count: { select: { structureLines: true } } } });
  if (!before) throw new NotFoundError("Salary component");
  if (before.isStatutory) throw new ConflictError("Statutory components cannot be deleted");
  if (before._count.structureLines > 0) {
    const after = await db.salaryComponent.update({ where: { id }, data: { isActive: false } });
    await audit(actor, "payroll.component.deactivate", "SalaryComponent", id, { before, after });
    return { deactivated: true };
  }
  await db.salaryComponent.delete({ where: { id } });
  await audit(actor, "payroll.component.delete", "SalaryComponent", id, { before });
  return { deleted: true };
}

// ───────────────────────────── Structures ─────────────────────────────

const structureInclude = { lines: { orderBy: { order: "asc" as const }, include: { component: true } }, _count: { select: { salaries: true } } };

function serializeStructure(s: Prisma.SalaryStructureGetPayload<{ include: typeof structureInclude }>) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    isDefault: s.isDefault,
    createdAt: s.createdAt.toISOString(),
    salaryCount: s._count.salaries,
    lines: s.lines.map((l) => ({
      id: l.id,
      componentId: l.componentId,
      code: l.component.code,
      name: l.component.name,
      type: l.component.type,
      calcType: l.calcType,
      value: num(l.value),
      order: l.order,
    })),
  };
}
export type StructureDto = ReturnType<typeof serializeStructure>;

export async function listStructures(actor: Actor) {
  await authorize(actor, "payroll:read");
  const rows = await db.salaryStructure.findMany({ include: structureInclude, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  return rows.map(serializeStructure);
}

export async function getStructure(actor: Actor, id: string) {
  await authorize(actor, "payroll:read");
  const s = await db.salaryStructure.findUnique({ where: { id }, include: structureInclude });
  if (!s) throw new NotFoundError("Salary structure");
  return serializeStructure(s);
}

async function validateLines(lines: z.infer<typeof structureLineSchema>[]) {
  const ids = [...new Set(lines.map((l) => l.componentId))];
  if (ids.length !== lines.length) throw new ValidationError("Each component may appear only once in a structure");
  const comps = await db.salaryComponent.findMany({ where: { id: { in: ids } } });
  if (comps.length !== ids.length) throw new ValidationError("Unknown salary component in lines");
  return comps;
}

export async function createStructure(actor: Actor, input: z.infer<typeof structureSchema>) {
  await authorize(actor, "payroll:manage");
  await validateLines(input.lines);
  const s = await db.$transaction(async (tx) => {
    if (input.isDefault) await tx.salaryStructure.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    return tx.salaryStructure.create({
      data: { name: input.name, description: input.description ?? null, isDefault: input.isDefault, lines: { create: input.lines.map((l, i) => ({ ...l, order: l.order || i + 1 })) } },
      include: structureInclude,
    });
  });
  await audit(actor, "payroll.structure.create", "SalaryStructure", s.id, { after: input });
  return serializeStructure(s);
}

export async function updateStructure(actor: Actor, id: string, input: z.infer<typeof updateStructureSchema>) {
  await authorize(actor, "payroll:manage");
  const before = await db.salaryStructure.findUnique({ where: { id }, include: structureInclude });
  if (!before) throw new NotFoundError("Salary structure");
  if (input.lines) await validateLines(input.lines);
  const s = await db.$transaction(async (tx) => {
    if (input.isDefault) await tx.salaryStructure.updateMany({ where: { isDefault: true, NOT: { id } }, data: { isDefault: false } });
    if (input.lines) {
      await tx.salaryStructureLine.deleteMany({ where: { structureId: id } });
      await tx.salaryStructureLine.createMany({ data: input.lines.map((l, i) => ({ ...l, structureId: id, order: l.order || i + 1 })) });
    }
    return tx.salaryStructure.update({
      where: { id },
      data: { name: input.name, description: input.description === undefined ? undefined : input.description, isDefault: input.isDefault },
      include: structureInclude,
    });
  });
  await audit(actor, "payroll.structure.update", "SalaryStructure", id, { before: serializeStructure(before), after: input });
  return serializeStructure(s);
}

export async function deleteStructure(actor: Actor, id: string) {
  await authorize(actor, "payroll:manage");
  const before = await db.salaryStructure.findUnique({ where: { id }, include: structureInclude });
  if (!before) throw new NotFoundError("Salary structure");
  if (before._count.salaries > 0) throw new ConflictError("Structure is assigned to employees and cannot be deleted");
  await db.salaryStructure.delete({ where: { id } });
  await audit(actor, "payroll.structure.delete", "SalaryStructure", id, { before: serializeStructure(before) });
  return { deleted: true };
}

/** Expand an annual CTC using a saved structure or ad-hoc lines (live preview in the setup UI). */
export async function previewStructure(actor: Actor, input: z.infer<typeof previewStructureSchema>) {
  await authorize(actor, "payroll:manage");
  let lines: { code: string; calcType: z.infer<typeof structureLineSchema>["calcType"]; value: number; type: ComponentLike["type"]; name: string }[];
  if (input.structureId) {
    const s = await getStructure(actor, input.structureId);
    lines = s.lines.map((l) => ({ code: l.code, calcType: l.calcType, value: l.value, type: l.type, name: l.name }));
  } else if (input.lines?.length) {
    const comps = await validateLines(input.lines);
    const byId = new Map(comps.map((c) => [c.id, c]));
    lines = [...input.lines]
      .sort((a, b) => a.order - b.order)
      .map((l) => {
        const c = byId.get(l.componentId)!;
        return { code: c.code, calcType: l.calcType, value: l.value, type: c.type, name: c.name };
      });
  } else throw new ValidationError("Provide structureId or lines");
  const monthly = computeMonthlyStructure(input.annualCtc, lines);
  return { monthly, lines: lines.map((l) => ({ code: l.code, name: l.name, type: l.type, monthly: monthly[l.code] ?? 0, annual: Math.round((monthly[l.code] ?? 0) * 12 * 100) / 100 })), monthlyCtc: Math.round((input.annualCtc / 12) * 100) / 100 };
}

// ───────────────────────────── Employee salaries ─────────────────────────────

export async function assignSalary(actor: Actor, input: z.infer<typeof assignSalarySchema>) {
  await authorize(actor, "payroll:manage");
  const emp = await db.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, displayName: true, status: true } });
  if (!emp) throw new NotFoundError("Employee");
  const structure = await db.salaryStructure.findUnique({ where: { id: input.structureId }, include: { lines: { orderBy: { order: "asc" }, include: { component: true } } } });
  if (!structure) throw new NotFoundError("Salary structure");
  const monthly = computeMonthlyStructure(
    input.annualCtc,
    structure.lines.map((l) => ({ code: l.component.code, calcType: l.calcType, value: num(l.value), type: l.component.type })),
  );
  const previous = await db.employeeSalary.findFirst({ where: { employeeId: input.employeeId, isCurrent: true }, orderBy: { effectiveFrom: "desc" } });
  if (previous && previous.effectiveFrom.getTime() > input.effectiveFrom.getTime()) {
    throw new ValidationError("Effective date must be on or after the current salary's effective date");
  }
  const created = await db.$transaction(async (tx) => {
    await tx.employeeSalary.updateMany({ where: { employeeId: input.employeeId, isCurrent: true }, data: { isCurrent: false } });
    const s = await tx.employeeSalary.create({
      data: {
        employeeId: input.employeeId,
        structureId: input.structureId,
        effectiveFrom: input.effectiveFrom,
        annualCtc: new Prisma.Decimal(input.annualCtc),
        monthly,
        pfApplicable: input.pfApplicable,
        esiApplicable: input.esiApplicable,
        ptApplicable: input.ptApplicable,
        taxRegime: input.taxRegime,
        isCurrent: true,
      },
      include: { structure: { select: { name: true } } },
    });
    if (previous) {
      await tx.jobHistory.create({
        data: { employeeId: input.employeeId, effectiveFrom: input.effectiveFrom, annualCtc: new Prisma.Decimal(input.annualCtc), reason: "Salary revision", note: input.note ?? `CTC ${num(previous.annualCtc)} → ${input.annualCtc}` },
      });
    }
    return s;
  });
  await audit(actor, "payroll.salary.assign", "EmployeeSalary", created.id, { before: previous ? serializeSalary(previous) : undefined, after: serializeSalary(created) });
  return serializeSalary(created);
}

export async function getCurrentSalary(actor: Actor, employeeId: string) {
  await authorize(actor, "payroll:read", { employeeId });
  const [current, history, employee] = await Promise.all([
    db.employeeSalary.findFirst({ where: { employeeId, isCurrent: true }, include: { structure: { select: { name: true } } }, orderBy: { effectiveFrom: "desc" } }),
    db.employeeSalary.findMany({ where: { employeeId }, include: { structure: { select: { name: true } } }, orderBy: { effectiveFrom: "desc" }, take: 50 }),
    db.employee.findUnique({ where: { id: employeeId }, select: { id: true, employeeCode: true, displayName: true, department: { select: { name: true } }, designation: { select: { name: true } } } }),
  ]);
  if (!employee) throw new NotFoundError("Employee");
  return {
    employee: { id: employee.id, employeeCode: employee.employeeCode, displayName: employee.displayName, department: employee.department?.name ?? null, designation: employee.designation?.name ?? null },
    current: current ? serializeSalary(current) : null,
    history: history.map(serializeSalary),
  };
}

export async function listSalaries(actor: Actor, p: z.infer<typeof salariesQuerySchema>) {
  if (!can(actor, "payroll:manage") && !can(actor, "employees:read_sensitive", "ALL")) throw new ForbiddenError("Missing permission payroll:manage");
  const where: Prisma.EmployeeSalaryWhereInput = {
    isCurrent: true,
    employee: {
      status: { not: "EXITED" },
      ...(p.departmentId ? { departmentId: p.departmentId } : {}),
      ...(p.q ? { OR: [{ displayName: { contains: p.q, mode: "insensitive" } }, { employeeCode: { contains: p.q, mode: "insensitive" } }, { workEmail: { contains: p.q, mode: "insensitive" } }] } : {}),
    },
  };
  const orderBy: Prisma.EmployeeSalaryOrderByWithRelationInput = p.sort === "ctc" ? { annualCtc: p.order } : p.sort === "effectiveFrom" ? { effectiveFrom: p.order } : { employee: { employeeCode: p.order } };
  const [rows, total] = await Promise.all([
    db.employeeSalary.findMany({
      where,
      orderBy,
      ...paginate(p),
      include: { structure: { select: { name: true } }, employee: { select: { employeeCode: true, displayName: true, department: { select: { name: true } }, designation: { select: { name: true } } } } },
    }),
    db.employeeSalary.count({ where }),
  ]);
  return toPage(
    rows.map((r) => ({ ...serializeSalary(r), employeeCode: r.employee.employeeCode, displayName: r.employee.displayName, department: r.employee.department?.name ?? null, designation: r.employee.designation?.name ?? null })),
    total,
    p,
  );
}

// ───────────────────────────── LOP days ─────────────────────────────

interface AttendanceSummary {
  workingDays: number;
  presentDays: number;
  wfhDays: number;
  halfDays: number;
  leaveDays: number;
  lopDays: number;
  holidays: number;
  weekOffs: number;
  absentDays: number;
}
type SummaryFn = (employeeId: string, year: number, month: number) => Promise<AttendanceSummary>;

let summaryFnPromise: Promise<SummaryFn | null> | undefined;
/** Resolve the attendance module's `monthlyAttendanceSummary` if it exists (built by the attendance module in parallel). */
async function attendanceSummaryFn(): Promise<SummaryFn | null> {
  if (!summaryFnPromise) {
    summaryFnPromise = (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore — optional cross-module dependency; falls back to a direct query when the module is missing.
        const mod: Record<string, unknown> = await import("@/server/services/attendance");
        const fn = mod.monthlyAttendanceSummary;
        return typeof fn === "function" ? (fn as SummaryFn) : null;
      } catch {
        return null;
      }
    })();
  }
  return summaryFnPromise;
}

/** Count Mon–Sat/Sun-aware weekday overlap of a leave with a month (fallback when the attendance module is absent). */
function weekdayOverlap(start: Date, end: Date, from: Date, to: Date): number {
  const s = Math.max(start.getTime(), from.getTime());
  const e = Math.min(end.getTime(), to.getTime());
  let n = 0;
  for (let t = s; t <= e; t += 86_400_000) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) n++;
  }
  return n;
}

/** Fallback: LOP = ABSENT days + 0.5 × HALF_DAY + approved unpaid leave days in the month, per employee. */
export async function lopDaysFallback(employeeIds: string[], year: number, month: number): Promise<Map<string, { lopDays: number; workingDays: number | null }>> {
  const { start, end } = monthRange(year, month);
  const out = new Map<string, { lopDays: number; workingDays: number | null }>();
  if (employeeIds.length === 0) return out;
  const [att, leaves] = await Promise.all([
    db.attendanceRecord.groupBy({
      by: ["employeeId", "status"],
      where: { employeeId: { in: employeeIds }, date: { gte: start, lte: end }, status: { in: ["ABSENT", "HALF_DAY"] } },
      _count: { _all: true },
    }),
    db.leaveRequest.findMany({
      where: { employeeId: { in: employeeIds }, status: "APPROVED", leaveType: { isPaid: false }, startDate: { lte: end }, endDate: { gte: start } },
      select: { employeeId: true, startDate: true, endDate: true, days: true },
    }),
  ]);
  for (const a of att) {
    const cur = out.get(a.employeeId) ?? { lopDays: 0, workingDays: null };
    cur.lopDays += a.status === "ABSENT" ? a._count._all : a._count._all * 0.5;
    out.set(a.employeeId, cur);
  }
  for (const l of leaves) {
    const cur = out.get(l.employeeId) ?? { lopDays: 0, workingDays: null };
    const inside = l.startDate.getTime() >= start.getTime() && l.endDate.getTime() <= end.getTime();
    cur.lopDays += inside ? num(l.days) : weekdayOverlap(l.startDate, l.endDate, start, end);
    out.set(l.employeeId, cur);
  }
  return out;
}

/** LOP days for one employee-month: attendance module when available, else the local fallback. */
export async function getLopDays(employeeId: string, year: number, month: number): Promise<number> {
  const fn = await attendanceSummaryFn();
  if (fn) {
    try {
      const s = await fn(employeeId, year, month);
      if (s && typeof s.lopDays === "number" && Number.isFinite(s.lopDays)) return s.lopDays;
    } catch (e) {
      console.warn("monthlyAttendanceSummary failed, using fallback", e);
    }
  }
  return (await lopDaysFallback([employeeId], year, month)).get(employeeId)?.lopDays ?? 0;
}

async function lopDaysForMany(employeeIds: string[], year: number, month: number): Promise<Map<string, { lopDays: number; workingDays: number | null }>> {
  const fn = await attendanceSummaryFn();
  if (!fn) return lopDaysFallback(employeeIds, year, month);
  const out = new Map<string, { lopDays: number; workingDays: number | null }>();
  const CONCURRENCY = 25;
  for (let i = 0; i < employeeIds.length; i += CONCURRENCY) {
    const slice = employeeIds.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (id) => {
        try {
          const s = await fn(id, year, month);
          return { id, lopDays: Number(s?.lopDays) || 0, workingDays: Number.isFinite(Number(s?.workingDays)) ? Number(s.workingDays) : null };
        } catch {
          return { id, lopDays: NaN, workingDays: null };
        }
      }),
    );
    const failed = results.filter((r) => Number.isNaN(r.lopDays)).map((r) => r.id);
    for (const r of results) if (!Number.isNaN(r.lopDays)) out.set(r.id, { lopDays: r.lopDays, workingDays: r.workingDays });
    if (failed.length) for (const [k, v] of await lopDaysFallback(failed, year, month)) out.set(k, v);
  }
  return out;
}

// ───────────────────────────── Runs ─────────────────────────────

function eligibleEmployeesWhere(legalEntityId: string, year: number, month: number): Prisma.EmployeeWhereInput {
  const { start, end } = monthRange(year, month);
  return {
    legalEntityId,
    status: { in: ["ACTIVE", "ON_NOTICE"] },
    joiningDate: { lte: end },
    OR: [{ exitDate: null }, { exitDate: { gte: start } }],
    salaries: { some: { isCurrent: true } },
  };
}

export async function createRun(actor: Actor, input: z.infer<typeof createRunSchema>) {
  await authorize(actor, "payroll:run");
  const legalEntityId = input.legalEntityId ?? (await defaultEntityId());
  const entity = await db.legalEntity.findUnique({ where: { id: legalEntityId }, select: { id: true } });
  if (!entity) throw new NotFoundError("Legal entity");
  const dup = await db.payrollRun.findUnique({ where: { legalEntityId_month_year: { legalEntityId, month: input.month, year: input.year } } });
  if (dup) throw new ConflictError(`A payroll run for ${input.month}/${input.year} already exists for this entity`);
  const employeeCount = await db.employee.count({ where: eligibleEmployeesWhere(legalEntityId, input.year, input.month) });
  const run = await db.payrollRun.create({
    data: { legalEntityId, month: input.month, year: input.year, status: "DRAFT", employeeCount, createdById: actor.userId, notes: input.notes },
    include: { legalEntity: { select: { name: true, ptState: true } } },
  });
  await audit(actor, "payroll.run.create", "PayrollRun", run.id, { after: { legalEntityId, month: input.month, year: input.year, employeeCount } });
  return serializeRun(run);
}

export async function listRuns(actor: Actor, p: z.infer<typeof runsQuerySchema>) {
  if (!RUN_READ(actor)) throw new ForbiddenError("Missing permission payroll:run");
  const where: Prisma.PayrollRunWhereInput = { ...(p.year ? { year: p.year } : {}), ...(p.status ? { status: p.status } : {}) };
  const [rows, total] = await Promise.all([
    db.payrollRun.findMany({ where, orderBy: [{ year: "desc" }, { month: "desc" }], ...paginate(p), include: { legalEntity: { select: { name: true, ptState: true } } } }),
    db.payrollRun.count({ where }),
  ]);
  return toPage(rows.map(serializeRun), total, p);
}

async function loadRun(runId: string) {
  const run = await db.payrollRun.findUnique({ where: { id: runId }, include: { legalEntity: true } });
  if (!run) throw new NotFoundError("Payroll run");
  return run;
}

export interface DeptBreakdown {
  department: string;
  count: number;
  gross: number;
  deductions: number;
  net: number;
  employerCost: number;
}

export async function getRun(actor: Actor, runId: string) {
  if (!RUN_READ(actor)) throw new ForbiddenError("Missing permission payroll:run");
  const run = await loadRun(runId);
  const [departments, adjustmentCount, stats] = await Promise.all([
    db.$queryRaw<DeptBreakdown[]>`
      SELECT COALESCE(d.name, 'Unassigned') AS department,
             COUNT(*)::int AS count,
             COALESCE(SUM(p.gross), 0)::float AS gross,
             COALESCE(SUM(p."totalDeductions"), 0)::float AS deductions,
             COALESCE(SUM(p."netPay"), 0)::float AS net,
             COALESCE(SUM(p."employerCost"), 0)::float AS "employerCost"
      FROM "Payslip" p
      JOIN "Employee" e ON e.id = p."employeeId"
      LEFT JOIN "Department" d ON d.id = e."departmentId"
      WHERE p."runId" = ${runId}::uuid
      GROUP BY 1 ORDER BY 1`,
    db.payrollAdjustment.count({ where: { month: run.month, year: run.year, OR: [{ runId }, { runId: null, employee: { legalEntityId: run.legalEntityId } }] } }),
    db.payslip.aggregate({ where: { runId }, _sum: { pfEmployee: true, pfEmployer: true, esiEmployee: true, esiEmployer: true, professionalTax: true, tds: true, lopDays: true }, _count: { _all: true } }),
  ]);
  return {
    ...serializeRun(run),
    departments,
    adjustmentCount,
    payslipCount: stats._count._all,
    statutory: {
      pfEmployee: num(stats._sum.pfEmployee),
      pfEmployer: num(stats._sum.pfEmployer),
      esiEmployee: num(stats._sum.esiEmployee),
      esiEmployer: num(stats._sum.esiEmployer),
      professionalTax: num(stats._sum.professionalTax),
      tds: num(stats._sum.tds),
      lopDays: num(stats._sum.lopDays),
    },
  };
}
export type RunDetail = Awaited<ReturnType<typeof getRun>>;

export async function listRunPayslips(actor: Actor, runId: string, p: Pagination) {
  if (!RUN_READ(actor)) throw new ForbiddenError("Missing permission payroll:run");
  const where: Prisma.PayslipWhereInput = {
    runId,
    ...(p.q ? { employee: { OR: [{ displayName: { contains: p.q, mode: "insensitive" } }, { employeeCode: { contains: p.q, mode: "insensitive" } }] } } : {}),
  };
  const orderBy: Prisma.PayslipOrderByWithRelationInput = p.sort === "netPay" ? { netPay: p.order } : p.sort === "gross" ? { gross: p.order } : { employee: { employeeCode: "asc" } };
  const [rows, total] = await Promise.all([
    db.payslip.findMany({ where, orderBy, ...paginate(p), include: { employee: { select: { employeeCode: true, displayName: true, department: { select: { name: true } } } } } }),
    db.payslip.count({ where }),
  ]);
  return toPage(
    rows.map((r) => ({ ...serializePayslip(r), employeeCode: r.employee.employeeCode, displayName: r.employee.displayName, department: r.employee.department?.name ?? null })),
    total,
    p,
  );
}

interface ProcessOptions {
  /** Await the full processing (default). When false the run is left PROCESSING and work continues in the background. */
  wait?: boolean;
}

/** Process a DRAFT/REVIEW run: compute and store a payslip for every eligible employee in chunks of 200. */
export async function processRun(actor: Actor, runId: string, opts: ProcessOptions = {}) {
  await authorize(actor, "payroll:run");
  const run = await loadRun(runId);
  if (run.status !== "DRAFT" && run.status !== "REVIEW") throw new ConflictError(`Run is ${run.status} and cannot be processed`);
  const ids = (await db.employee.findMany({ where: eligibleEmployeesWhere(run.legalEntityId, run.year, run.month), select: { id: true }, orderBy: { employeeCode: "asc" } })).map((e) => e.id);
  await db.$transaction([
    db.payslip.deleteMany({ where: { runId } }),
    db.payrollAdjustment.updateMany({ where: { runId }, data: { runId: null } }),
    db.payrollRun.update({ where: { id: runId }, data: { status: "PROCESSING", employeeCount: ids.length, processedCount: 0, totalGross: 0, totalDeductions: 0, totalNet: 0, totalEmployerCost: 0 } }),
  ]);
  await audit(actor, "payroll.run.process", "PayrollRun", runId, { after: { employeeCount: ids.length } });

  const work = (async () => {
    try {
      const components = await componentMap();
      const statutory: StatutoryConfig = {
        pfWageCeiling: num(run.legalEntity.pfWageCeiling),
        pfEmployeePct: num(run.legalEntity.pfEmployeePct),
        pfEmployerPct: num(run.legalEntity.pfEmployerPct),
        esiWageCeiling: num(run.legalEntity.esiWageCeiling),
        esiEmployeePct: num(run.legalEntity.esiEmployeePct),
        esiEmployerPct: num(run.legalEntity.esiEmployerPct),
        ptState: run.legalEntity.ptState,
      };
      for (let i = 0; i < ids.length; i += CHUNK) {
        await processChunk(run, ids.slice(i, i + CHUNK), components, statutory);
      }
      const sums = await db.payslip.aggregate({ where: { runId }, _sum: { gross: true, totalDeductions: true, netPay: true, employerCost: true } });
      await db.payrollRun.update({
        where: { id: runId },
        data: { status: "REVIEW", totalGross: sums._sum.gross ?? 0, totalDeductions: sums._sum.totalDeductions ?? 0, totalNet: sums._sum.netPay ?? 0, totalEmployerCost: sums._sum.employerCost ?? 0 },
      });
    } catch (e) {
      console.error("payroll processing failed", e);
      await db.payrollRun.update({ where: { id: runId }, data: { status: "DRAFT", notes: `Processing failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500) } }).catch(() => {});
      throw e;
    }
  })();

  if (opts.wait === false) {
    work.catch(() => {});
    return getRun(actor, runId);
  }
  await work;
  return getRun(actor, runId);
}

type RunWithEntity = Prisma.PayrollRunGetPayload<{ include: { legalEntity: true } }>;

async function processChunk(run: RunWithEntity, chunk: string[], components: Awaited<ReturnType<typeof componentMap>>, statutory: StatutoryConfig) {
  const { year, month } = run;
  const { days: daysInMonth, end: monthEnd } = monthRange(year, month);
  const fy = fyOf(year, month);
  const fyStart = Number(fy.slice(0, 4));
  const idx = monthIndexInFy(month);
  const monthsRemaining = 13 - idx;
  const priorMonths = fyMonthsBefore(year, month);
  const priorKey = new Set(priorMonths.map((m) => `${m.year}-${m.month}`));

  const [employees, lop, adjustments, declarations, priorPayslips, priorNonTaxableAdj] = await Promise.all([
    db.employee.findMany({
      where: { id: { in: chunk } },
      select: { id: true, dateOfBirth: true, salaries: { where: { isCurrent: true }, orderBy: { effectiveFrom: "desc" }, take: 1 } },
    }),
    lopDaysForMany(chunk, year, month),
    db.payrollAdjustment.findMany({ where: { employeeId: { in: chunk }, month, year, OR: [{ runId: null }, { runId: run.id }] } }),
    db.taxDeclaration.findMany({ where: { employeeId: { in: chunk }, financialYear: fy, status: { in: ["SUBMITTED", "VERIFIED"] } }, select: { employeeId: true, regime: true, declarations: true } }),
    priorMonths.length
      ? db.payslip.findMany({
          where: { employeeId: { in: chunk }, runId: { not: run.id }, OR: [{ year: fyStart, month: { gte: 4 } }, { year: fyStart + 1, month: { lte: 3 } }], run: { status: { in: ["FINALIZED", "PAID"] } } },
          select: { employeeId: true, year: true, month: true, earnings: true, tds: true },
        })
      : Promise.resolve([]),
    priorMonths.length
      ? db.payrollAdjustment.findMany({
          where: { employeeId: { in: chunk }, type: "EARNING", isTaxable: false, runId: { not: null }, OR: [{ year: fyStart, month: { gte: 4 } }, { year: fyStart + 1, month: { lte: 3 } }] },
          select: { employeeId: true, year: true, month: true, amount: true },
        })
      : Promise.resolve([]),
  ]);

  const adjByEmp = new Map<string, AdjustmentLike[]>();
  for (const a of adjustments) {
    const list = adjByEmp.get(a.employeeId) ?? [];
    list.push({ code: a.code, label: a.label, type: a.type, amount: num(a.amount), isTaxable: a.isTaxable });
    adjByEmp.set(a.employeeId, list);
  }
  const declByEmp = new Map(declarations.map((d) => [d.employeeId, d]));
  const prior = new Map<string, { taxable: number; tds: number }>();
  const isTaxableCode = (code: string) => components.get(code)?.isTaxable ?? true;
  for (const p of priorPayslips) {
    if (!priorKey.has(`${p.year}-${p.month}`)) continue;
    const cur = prior.get(p.employeeId) ?? { taxable: 0, tds: 0 };
    for (const [code, amt] of Object.entries(jsonNum(p.earnings))) if (isTaxableCode(code)) cur.taxable += amt;
    cur.tds += num(p.tds);
    prior.set(p.employeeId, cur);
  }
  for (const a of priorNonTaxableAdj) {
    if (!priorKey.has(`${a.year}-${a.month}`)) continue;
    const cur = prior.get(a.employeeId);
    if (cur) cur.taxable -= num(a.amount);
  }

  const rows: Prisma.PayslipCreateManyInput[] = [];
  for (const e of employees) {
    const salary = e.salaries[0];
    if (!salary) continue;
    const monthly = jsonNum(salary.monthly);
    const decl = declByEmp.get(e.id);
    const regime: Regime = (decl?.regime ?? salary.taxRegime) as Regime;
    const declarations = decl ? (jsonNum(decl.declarations) as Partial<Record<DeclarationKey, number>>) : {};
    const monthlyTaxable = Object.entries(monthly).reduce((sum, [code, amt]) => {
      const c = components.get(code);
      const earning = !c || c.type === "EARNING" || c.type === "REIMBURSEMENT";
      return earning && (c?.isTaxable ?? true) ? sum + amt : sum;
    }, 0);
    const adj = adjByEmp.get(e.id) ?? [];
    const taxableAdj = adj.filter((a) => a.type === "EARNING" && a.isTaxable).reduce((s, a) => s + a.amount, 0);
    const pr = prior.get(e.id) ?? { taxable: 0, tds: 0 };
    const l = lop.get(e.id);
    const age = e.dateOfBirth ? Math.floor((monthEnd.getTime() - e.dateOfBirth.getTime()) / (365.25 * 86_400_000)) : undefined;

    const result = computePayslip({
      monthly,
      components: [...components.values()],
      daysInMonth,
      lopDays: l?.lopDays ?? 0,
      month,
      statutory,
      flags: { pfApplicable: salary.pfApplicable, esiApplicable: salary.esiApplicable, ptApplicable: salary.ptApplicable },
      adjustments: adj,
      annualTaxAlreadyPaid: pr.tds,
      projectedAnnualTaxable: pr.taxable + monthlyTaxable * monthsRemaining + taxableAdj,
      regime,
      declarations,
      monthIndexInFY: idx,
      monthsRemainingInFY: monthsRemaining,
      age,
      fy,
    });
    rows.push({
      runId: run.id,
      employeeId: e.id,
      month,
      year,
      workingDays: l?.workingDays ?? daysInMonth,
      payableDays: result.payableDays,
      lopDays: result.lopDays,
      earnings: result.earnings,
      deductions: result.deductions,
      employerContributions: result.employerContributions,
      gross: result.gross,
      totalDeductions: result.totalDeductions,
      netPay: result.netPay,
      employerCost: result.employerCost,
      pfEmployee: result.pfEmployee,
      pfEmployer: result.pfEmployer,
      esiEmployee: result.esiEmployee,
      esiEmployer: result.esiEmployer,
      professionalTax: result.professionalTax,
      tds: result.tds,
    });
  }

  await db.$transaction(async (tx: Tx) => {
    await tx.payslip.deleteMany({ where: { runId: run.id, employeeId: { in: chunk } } });
    if (rows.length) await tx.payslip.createMany({ data: rows });
    if (adjustments.length) await tx.payrollAdjustment.updateMany({ where: { id: { in: adjustments.map((a) => a.id) } }, data: { runId: run.id } });
    await tx.payrollRun.update({ where: { id: run.id }, data: { processedCount: { increment: chunk.length } } });
  });
}

export async function finalizeRun(actor: Actor, runId: string) {
  await authorize(actor, "payroll:finalize");
  const run = await loadRun(runId);
  if (run.status !== "REVIEW") throw new ConflictError(`Only runs in REVIEW can be finalised (current: ${run.status})`);
  const updated = await db.payrollRun.update({ where: { id: runId }, data: { status: "FINALIZED", finalizedAt: new Date() }, include: { legalEntity: { select: { name: true, ptState: true } } } });
  await audit(actor, "payroll.run.finalize", "PayrollRun", runId, { before: { status: run.status }, after: { status: "FINALIZED" } });
  const label = `${monthLabel(run.month)} ${run.year}`;
  const payslips = await db.payslip.findMany({ where: { runId }, select: { id: true, employeeId: true } });
  for (let i = 0; i < payslips.length; i += CHUNK) {
    await Promise.all(
      payslips.slice(i, i + CHUNK).map((p) =>
        notify({ employeeId: p.employeeId, type: "payroll.payslip", title: `Your payslip for ${label} is ready`, body: "Your salary has been processed. Open the payslip to view the breakdown.", link: `/payroll/my/${p.id}`, email: true }),
      ),
    );
  }
  return serializeRun(updated);
}

export async function markPaid(actor: Actor, runId: string, input: z.infer<typeof markPaidSchema>) {
  await authorize(actor, "payroll:finalize");
  const run = await loadRun(runId);
  if (run.status !== "FINALIZED") throw new ConflictError(`Only FINALIZED runs can be marked paid (current: ${run.status})`);
  const paidAt = input.paidAt ?? new Date();
  const [updated] = await db.$transaction([
    db.payrollRun.update({ where: { id: runId }, data: { status: "PAID", paidAt }, include: { legalEntity: { select: { name: true, ptState: true } } } }),
    db.payslip.updateMany({ where: { runId }, data: { paidAt, paymentRef: input.paymentRef } }),
  ]);
  await audit(actor, "payroll.run.pay", "PayrollRun", runId, { after: { paymentRef: input.paymentRef, paidAt } });
  return serializeRun(updated);
}

/** REVIEW → DRAFT (deletes payslips). Finalised runs cannot be reopened. */
export async function reopenRun(actor: Actor, runId: string) {
  await authorize(actor, "payroll:run");
  const run = await loadRun(runId);
  if (run.status === "FINALIZED" || run.status === "PAID") throw new ConflictError("A finalised run cannot be reopened");
  const [, , updated] = await db.$transaction([
    db.payslip.deleteMany({ where: { runId } }),
    db.payrollAdjustment.updateMany({ where: { runId }, data: { runId: null } }),
    db.payrollRun.update({ where: { id: runId }, data: { status: "DRAFT", processedCount: 0, totalGross: 0, totalDeductions: 0, totalNet: 0, totalEmployerCost: 0 }, include: { legalEntity: { select: { name: true, ptState: true } } } }),
  ]);
  await audit(actor, "payroll.run.reopen", "PayrollRun", runId, { before: { status: run.status }, after: { status: "DRAFT" } });
  return serializeRun(updated);
}

/** Delete a DRAFT run entirely. */
export async function deleteRun(actor: Actor, runId: string) {
  await authorize(actor, "payroll:run");
  const run = await loadRun(runId);
  if (run.status !== "DRAFT") throw new ConflictError("Only DRAFT runs can be deleted — reopen it first");
  await db.$transaction([db.payrollAdjustment.updateMany({ where: { runId }, data: { runId: null } }), db.payrollRun.delete({ where: { id: runId } })]);
  await audit(actor, "payroll.run.delete", "PayrollRun", runId, { before: serializeRun(run) });
  return { deleted: true };
}

// ───────────────────────────── Exports ─────────────────────────────

const EXPORT_PAGE = 500;

async function* payslipPages<I extends Prisma.PayslipInclude>(runId: string, include: I): AsyncGenerator<Prisma.PayslipGetPayload<{ include: I }>[]> {
  let cursor: string | undefined;
  for (;;) {
    const rows = await db.payslip.findMany({ where: { runId }, include, orderBy: { id: "asc" }, take: EXPORT_PAGE, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    if (rows.length === 0) return;
    yield rows as Prisma.PayslipGetPayload<{ include: I }>[];
    if (rows.length < EXPORT_PAGE) return;
    cursor = rows[rows.length - 1].id;
  }
}

export async function bankAdviceCsv(actor: Actor, runId: string): Promise<{ filename: string; content: string }> {
  await authorize(actor, "payroll:finalize");
  const run = await loadRun(runId);
  if (run.status === "DRAFT" || run.status === "PROCESSING") throw new ConflictError("Run has not been processed yet");
  const rows: (string | number)[][] = [["Employee Code", "Name", "Bank", "IFSC", "Account Number", "Account Holder", "Net Pay", "Narration"]];
  const narration = `SAL ${monthLabel(run.month).slice(0, 3).toUpperCase()} ${run.year}`;
  let count = 0;
  for await (const page of payslipPages(runId, { employee: { select: { employeeCode: true, displayName: true, bankAccount: true } } })) {
    for (const p of page) {
      const e = p.employee;
      const acct = e.bankAccount ? (decryptField(e.bankAccount.accountNumberEnc) ?? "") : "";
      rows.push([e.employeeCode, e.displayName, e.bankAccount?.bankName ?? "", e.bankAccount?.ifsc ?? "", acct, e.bankAccount?.accountHolder ?? e.displayName, num(p.netPay), narration]);
      count++;
    }
  }
  await audit(actor, "payroll.export.bank_advice", "PayrollRun", runId, { after: { rows: count } });
  return { filename: `bank-advice-${run.year}-${String(run.month).padStart(2, "0")}.csv`, content: csv(rows) };
}

export async function pfEcrCsv(actor: Actor, runId: string): Promise<{ filename: string; content: string }> {
  await authorize(actor, "payroll:run");
  await authorize(actor, "employees:read_sensitive", { minScope: "ALL" });
  const run = await loadRun(runId);
  const rows: (string | number)[][] = [["UAN", "Member Name", "Gross Wages", "EPF Wages", "EPS Wages", "EDLI Wages", "EPF Contribution (EE)", "EPS Contribution (ER)", "EPF-EPS Diff (ER)", "NCP Days", "Refund of Advances"]];
  const ceiling = num(run.legalEntity.pfWageCeiling);
  let count = 0;
  for await (const page of payslipPages(runId, { employee: { select: { displayName: true, uanEnc: true } } })) {
    for (const p of page) {
      const pfEe = num(p.pfEmployee);
      if (pfEe <= 0) continue;
      const e = p.employee;
      const earnings = jsonNum(p.earnings);
      const basic = earnings.BASIC ?? 0;
      const epfWage = Math.min(basic, ceiling);
      const eps = Math.min(1250, Math.round(epfWage * 0.0833), num(p.pfEmployer));
      rows.push([decryptField(e.uanEnc) ?? "", e.displayName, num(p.gross), epfWage, epfWage, epfWage, pfEe, eps, num(p.pfEmployer) - eps, Math.round(num(p.lopDays)), 0]);
      count++;
    }
  }
  await audit(actor, "payroll.export.pf_ecr", "PayrollRun", runId, { after: { rows: count } });
  return { filename: `pf-ecr-${run.year}-${String(run.month).padStart(2, "0")}.csv`, content: csv(rows) };
}

export async function ptSummaryCsv(actor: Actor, runId: string): Promise<{ filename: string; content: string }> {
  await authorize(actor, "payroll:run");
  const run = await loadRun(runId);
  const rows: (string | number)[][] = [["Employee Code", "Name", "State", "Gross", "Professional Tax"]];
  let total = 0;
  for await (const page of payslipPages(runId, { employee: { select: { employeeCode: true, displayName: true } } })) {
    for (const p of page) {
      const e = p.employee;
      const pt = num(p.professionalTax);
      if (pt <= 0) continue;
      total += pt;
      rows.push([e.employeeCode, e.displayName, run.legalEntity.ptState ?? "", num(p.gross), pt]);
    }
  }
  rows.push(["", "TOTAL", "", "", total]);
  await audit(actor, "payroll.export.pt", "PayrollRun", runId, { after: { total } });
  return { filename: `pt-summary-${run.year}-${String(run.month).padStart(2, "0")}.csv`, content: csv(rows) };
}

export async function payrollRegisterCsv(actor: Actor, runId: string): Promise<{ filename: string; content: string }> {
  await authorize(actor, "payroll:run");
  const run = await loadRun(runId);
  const comps = await db.salaryComponent.findMany({ orderBy: { order: "asc" }, select: { code: true, type: true } });
  const earningCodes = comps.filter((c) => c.type === "EARNING" || c.type === "REIMBURSEMENT").map((c) => c.code);
  const deductionCodes = comps.filter((c) => c.type === "DEDUCTION").map((c) => c.code);
  const employerCodes = comps.filter((c) => c.type === "EMPLOYER_CONTRIBUTION").map((c) => c.code);
  const extraEarn = new Set<string>();
  const extraDed = new Set<string>();
  const data: { e: { employeeCode: string; displayName: string; department: { name: string } | null; designation: { name: string } | null }; p: PayslipRow }[] = [];
  for await (const page of payslipPages(runId, { employee: { select: { employeeCode: true, displayName: true, department: { select: { name: true } }, designation: { select: { name: true } } } } })) {
    for (const p of page) {
      const e = p.employee;
      for (const k of Object.keys(jsonNum(p.earnings))) if (!earningCodes.includes(k)) extraEarn.add(k);
      for (const k of Object.keys(jsonNum(p.deductions))) if (!deductionCodes.includes(k)) extraDed.add(k);
      data.push({ e, p });
    }
  }
  const eCols = [...earningCodes, ...extraEarn];
  const dCols = [...deductionCodes, ...extraDed];
  const rows: (string | number)[][] = [
    ["Employee Code", "Name", "Department", "Designation", "Month", "Year", "Working Days", "Payable Days", "LOP Days", ...eCols, "Gross", ...dCols, "Total Deductions", "Net Pay", ...employerCodes, "Employer Cost", "Payment Ref"],
  ];
  for (const { e, p } of data) {
    const earn = jsonNum(p.earnings);
    const ded = jsonNum(p.deductions);
    const er = jsonNum(p.employerContributions);
    rows.push([
      e.employeeCode, e.displayName, e.department?.name ?? "", e.designation?.name ?? "", p.month, p.year, num(p.workingDays), num(p.payableDays), num(p.lopDays),
      ...eCols.map((c) => earn[c] ?? 0), num(p.gross), ...dCols.map((c) => ded[c] ?? 0), num(p.totalDeductions), num(p.netPay), ...employerCodes.map((c) => er[c] ?? 0), num(p.employerCost), p.paymentRef ?? "",
    ]);
  }
  await audit(actor, "payroll.export.register", "PayrollRun", runId, { after: { rows: data.length } });
  return { filename: `payroll-register-${run.year}-${String(run.month).padStart(2, "0")}.csv`, content: csv(rows) };
}

export async function exportRun(actor: Actor, runId: string, type: "bank" | "pf" | "pt" | "register") {
  switch (type) {
    case "bank":
      return bankAdviceCsv(actor, runId);
    case "pf":
      return pfEcrCsv(actor, runId);
    case "pt":
      return ptSummaryCsv(actor, runId);
    case "register":
      return payrollRegisterCsv(actor, runId);
  }
}

// ───────────────────────────── Adjustments ─────────────────────────────

function serializeAdjustment(a: Prisma.PayrollAdjustmentGetPayload<{ include: { employee: { select: { employeeCode: true; displayName: true } } } }>) {
  return {
    id: a.id,
    employeeId: a.employeeId,
    employeeCode: a.employee.employeeCode,
    displayName: a.employee.displayName,
    runId: a.runId,
    month: a.month,
    year: a.year,
    type: a.type,
    code: a.code,
    label: a.label,
    amount: num(a.amount),
    isTaxable: a.isTaxable,
    reason: a.reason,
    createdAt: a.createdAt.toISOString(),
  };
}
export type AdjustmentDto = ReturnType<typeof serializeAdjustment>;

export async function addAdjustment(actor: Actor, input: z.infer<typeof adjustmentSchema>) {
  await authorize(actor, "payroll:run");
  const emp = await db.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, legalEntityId: true } });
  if (!emp) throw new NotFoundError("Employee");
  if (emp.legalEntityId) {
    const run = await db.payrollRun.findUnique({ where: { legalEntityId_month_year: { legalEntityId: emp.legalEntityId, month: input.month, year: input.year } }, select: { status: true } });
    if (run && (run.status === "FINALIZED" || run.status === "PAID")) throw new ConflictError("Payroll for that month is already finalised");
  }
  const a = await db.payrollAdjustment.create({ data: { ...input, createdById: actor.userId }, include: { employee: { select: { employeeCode: true, displayName: true } } } });
  await audit(actor, "payroll.adjustment.create", "PayrollAdjustment", a.id, { after: serializeAdjustment(a) });
  return serializeAdjustment(a);
}

export async function listAdjustments(actor: Actor, p: z.infer<typeof adjustmentsQuerySchema>) {
  if (!RUN_READ(actor)) throw new ForbiddenError("Missing permission payroll:run");
  const where: Prisma.PayrollAdjustmentWhereInput = {
    ...(p.month ? { month: p.month } : {}),
    ...(p.year ? { year: p.year } : {}),
    ...(p.employeeId ? { employeeId: p.employeeId } : {}),
    ...(p.runId ? { OR: [{ runId: p.runId }, { runId: null }] } : {}),
    ...(p.q ? { employee: { OR: [{ displayName: { contains: p.q, mode: "insensitive" } }, { employeeCode: { contains: p.q, mode: "insensitive" } }] } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.payrollAdjustment.findMany({ where, orderBy: { createdAt: "desc" }, ...paginate(p), include: { employee: { select: { employeeCode: true, displayName: true } } } }),
    db.payrollAdjustment.count({ where }),
  ]);
  return toPage(rows.map(serializeAdjustment), total, p);
}

export async function deleteAdjustment(actor: Actor, id: string) {
  await authorize(actor, "payroll:run");
  const a = await db.payrollAdjustment.findUnique({ where: { id }, include: { run: { select: { status: true } }, employee: { select: { employeeCode: true, displayName: true } } } });
  if (!a) throw new NotFoundError("Adjustment");
  if (a.run && (a.run.status === "FINALIZED" || a.run.status === "PAID")) throw new ConflictError("Adjustment belongs to a finalised run");
  await db.payrollAdjustment.delete({ where: { id } });
  await audit(actor, "payroll.adjustment.delete", "PayrollAdjustment", id, { before: serializeAdjustment(a) });
  return { deleted: true };
}

// ───────────────────────────── My payroll ─────────────────────────────

export async function listMyPayslips(actor: Actor, employeeId?: string, opts: { year?: number } = {}) {
  const target = employeeId ?? requireEmployee(actor);
  await authorize(actor, "payroll:read", { employeeId: target });
  const publishedOnly = !can(actor, "payroll:run");
  const rows = await db.payslip.findMany({
    where: { employeeId: target, ...(opts.year ? { year: opts.year } : {}), ...(publishedOnly ? { run: { status: { in: ["FINALIZED", "PAID"] } } } : {}) },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    take: 60,
    include: { run: { select: { status: true } } },
  });
  return rows.map((r) => ({ ...serializePayslip(r), runStatus: r.run.status }));
}

export async function getPayslip(actor: Actor, payslipId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(payslipId)) throw new NotFoundError("Payslip");
  const p = await db.payslip.findUnique({ where: { id: payslipId }, include: { run: { select: { status: true } } } });
  if (!p) throw new NotFoundError("Payslip");
  await authorize(actor, "payroll:read", { employeeId: p.employeeId });
  if (!can(actor, "payroll:run") && p.run.status !== "FINALIZED" && p.run.status !== "PAID") throw new NotFoundError("Payslip");
  return { ...serializePayslip(p), runStatus: p.run.status };
}

/** Everything the printable payslip needs: company header, employee block, ordered lines with names, net pay in words. */
export async function payslipViewModel(actor: Actor, payslipId: string) {
  const base = await getPayslip(actor, payslipId);
  const [emp, comps] = await Promise.all([
    db.employee.findUnique({
      where: { id: base.employeeId },
      select: {
        employeeCode: true,
        displayName: true,
        joiningDate: true,
        panEnc: true,
        uanEnc: true,
        pfNumber: true,
        esiNumber: true,
        department: { select: { name: true } },
        designation: { select: { name: true } },
        location: { select: { name: true, city: true } },
        legalEntity: { select: { name: true, address: true, pan: true, tan: true, pfCode: true, esiCode: true } },
        bankAccount: { select: { bankName: true, accountLast4: true } },
        salaries: { where: { isCurrent: true }, take: 1, select: { annualCtc: true, taxRegime: true } },
      },
    }),
    db.salaryComponent.findMany({ orderBy: { order: "asc" } }),
  ]);
  if (!emp) throw new NotFoundError("Employee");
  const byCode = new Map(comps.map((c) => [c.code, c]));
  const lines = (obj: Record<string, number>) =>
    Object.entries(obj)
      .filter(([, v]) => v !== 0)
      .map(([code, amount]) => ({ code, name: byCode.get(code)?.name ?? code.replaceAll("_", " "), amount, order: byCode.get(code)?.order ?? 500 }))
      .sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
  const sensitive = can(actor, "employees:read_sensitive") && (await authorize(actor, "employees:read_sensitive", { employeeId: base.employeeId }).then(() => true, () => false));
  const pan = decryptField(emp.panEnc);
  const uan = decryptField(emp.uanEnc);
  const address = (emp.legalEntity?.address ?? null) as Record<string, string> | null;
  return {
    ...base,
    company: {
      name: emp.legalEntity?.name ?? "",
      address: address ? [address.line1, address.line2, address.city, address.state, address.pincode].filter(Boolean).join(", ") : "",
      pan: emp.legalEntity?.pan ?? null,
      tan: emp.legalEntity?.tan ?? null,
      pfCode: emp.legalEntity?.pfCode ?? null,
      esiCode: emp.legalEntity?.esiCode ?? null,
    },
    employee: {
      employeeCode: emp.employeeCode,
      displayName: emp.displayName,
      designation: emp.designation?.name ?? null,
      department: emp.department?.name ?? null,
      location: emp.location?.city ?? emp.location?.name ?? null,
      joiningDate: emp.joiningDate.toISOString().slice(0, 10),
      pan: sensitive ? pan : mask(pan),
      uan: sensitive ? uan : mask(uan),
      pfNumber: emp.pfNumber,
      esiNumber: emp.esiNumber,
      bankName: emp.bankAccount?.bankName ?? null,
      accountLast4: emp.bankAccount?.accountLast4 ?? null,
      annualCtc: emp.salaries[0] ? num(emp.salaries[0].annualCtc) : null,
      taxRegime: emp.salaries[0]?.taxRegime ?? null,
    },
    earningLines: lines(base.earnings),
    deductionLines: lines(base.deductions),
    employerLines: lines(base.employerContributions),
    netPayInWords: `${amountInWords(base.netPay)} Rupees Only`,
    monthLabel: `${monthLabel(base.month)} ${base.year}`,
  };
}
export type PayslipView = Awaited<ReturnType<typeof payslipViewModel>>;

// ───────────────────────────── Tax declarations ─────────────────────────────

function serializeDeclaration(d: Prisma.TaxDeclarationGetPayload<{ include: { employee: { select: { employeeCode: true; displayName: true; department: { select: { name: true } } } } } }>) {
  return {
    id: d.id,
    employeeId: d.employeeId,
    employeeCode: d.employee.employeeCode,
    displayName: d.employee.displayName,
    department: d.employee.department?.name ?? null,
    financialYear: d.financialYear,
    regime: d.regime as Regime,
    declarations: jsonNum(d.declarations),
    status: d.status,
    submittedAt: d.submittedAt?.toISOString() ?? null,
    verifiedAt: d.verifiedAt?.toISOString() ?? null,
    verifiedById: d.verifiedById,
    note: d.note,
    updatedAt: d.updatedAt.toISOString(),
  };
}
export type DeclarationDto = ReturnType<typeof serializeDeclaration>;
const declInclude = { employee: { select: { employeeCode: true, displayName: true, department: { select: { name: true } } } } };

export function currentFy(): string {
  return financialYear(todayUtc());
}

async function canReadDeclaration(actor: Actor, employeeId: string) {
  if (can(actor, "tax:verify")) return;
  await authorize(actor, "tax:declare", { employeeId });
}

export async function getDeclaration(actor: Actor, employeeId: string, fy: string = currentFy()) {
  await canReadDeclaration(actor, employeeId);
  const d = await db.taxDeclaration.findUnique({ where: { employeeId_financialYear: { employeeId, financialYear: fy } }, include: declInclude });
  return d ? serializeDeclaration(d) : null;
}

export async function saveDeclaration(actor: Actor, employeeId: string, input: z.infer<typeof declarationSchema>) {
  await authorize(actor, "tax:declare", { employeeId });
  const fy = input.financialYear ?? currentFy();
  const clean: Record<string, number> = {};
  for (const k of DECLARATION_KEYS) if (input.declarations[k] !== undefined) clean[k] = input.declarations[k];
  if (input.declarations.HRA_RENT !== undefined) clean.HRA_RENT = input.declarations.HRA_RENT;
  const existing = await db.taxDeclaration.findUnique({ where: { employeeId_financialYear: { employeeId, financialYear: fy } } });
  if (existing && existing.status !== "DRAFT" && existing.status !== "REJECTED") throw new ConflictError(`Declaration is ${existing.status} and can no longer be edited`);
  const d = await db.taxDeclaration.upsert({
    where: { employeeId_financialYear: { employeeId, financialYear: fy } },
    create: { employeeId, financialYear: fy, regime: input.regime, declarations: clean, status: "DRAFT" },
    update: { regime: input.regime, declarations: clean, status: "DRAFT", note: null },
    include: declInclude,
  });
  await audit(actor, "tax.declaration.save", "TaxDeclaration", d.id, { before: existing ? { regime: existing.regime, declarations: existing.declarations, status: existing.status } : undefined, after: { regime: d.regime, declarations: clean } });
  return serializeDeclaration(d);
}

export async function submitDeclaration(actor: Actor, id: string) {
  const d = await db.taxDeclaration.findUnique({ where: { id } });
  if (!d) throw new NotFoundError("Tax declaration");
  await authorize(actor, "tax:declare", { employeeId: d.employeeId });
  if (d.status !== "DRAFT" && d.status !== "REJECTED") throw new ConflictError(`Declaration is already ${d.status}`);
  const after = await db.taxDeclaration.update({ where: { id }, data: { status: "SUBMITTED", submittedAt: new Date(), note: null }, include: declInclude });
  await audit(actor, "tax.declaration.submit", "TaxDeclaration", id, { before: { status: d.status }, after: { status: "SUBMITTED" } });
  return serializeDeclaration(after);
}

export async function verifyDeclaration(actor: Actor, id: string, input: z.infer<typeof verifyDeclarationSchema>) {
  await authorize(actor, "tax:verify");
  const d = await db.taxDeclaration.findUnique({ where: { id } });
  if (!d) throw new NotFoundError("Tax declaration");
  if (d.status !== "SUBMITTED") throw new ConflictError(`Only SUBMITTED declarations can be verified (current: ${d.status})`);
  const after = await db.taxDeclaration.update({
    where: { id },
    data: { status: input.decision as DeclarationStatus, verifiedAt: new Date(), verifiedById: actor.employeeId, note: input.note ?? null },
    include: declInclude,
  });
  await audit(actor, "tax.declaration.verify", "TaxDeclaration", id, { before: { status: d.status }, after: { status: input.decision, note: input.note } });
  await notify({
    employeeId: d.employeeId,
    type: "tax.declaration",
    title: input.decision === "VERIFIED" ? `Your tax declaration for FY ${d.financialYear} was verified` : `Your tax declaration for FY ${d.financialYear} was rejected`,
    body: input.note ?? (input.decision === "VERIFIED" ? "Your investment proofs have been accepted." : "Please review the note and resubmit."),
    link: "/payroll/my?tab=tax",
    email: true,
  });
  return serializeDeclaration(after);
}

export async function listDeclarations(actor: Actor, p: z.infer<typeof declarationsQuerySchema>) {
  await authorize(actor, "tax:verify");
  const where: Prisma.TaxDeclarationWhereInput = {
    financialYear: p.fy ?? currentFy(),
    ...(p.status ? { status: p.status } : {}),
    ...(p.q ? { employee: { OR: [{ displayName: { contains: p.q, mode: "insensitive" } }, { employeeCode: { contains: p.q, mode: "insensitive" } }] } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.taxDeclaration.findMany({ where, orderBy: [{ status: "asc" }, { submittedAt: "asc" }], ...paginate(p), include: declInclude }),
    db.taxDeclaration.count({ where }),
  ]);
  return toPage(rows.map(serializeDeclaration), total, p);
}

/** Projected annual tax under both regimes from the employee's current salary and declaration (any status). */
export async function taxProjection(actor: Actor, employeeId: string, fy: string = currentFy()) {
  await canReadDeclaration(actor, employeeId).catch(async () => authorize(actor, "payroll:read", { employeeId }));
  const [salary, decl, comps, emp] = await Promise.all([
    db.employeeSalary.findFirst({ where: { employeeId, isCurrent: true }, orderBy: { effectiveFrom: "desc" } }),
    db.taxDeclaration.findUnique({ where: { employeeId_financialYear: { employeeId, financialYear: fy } } }),
    db.salaryComponent.findMany({ select: { code: true, type: true, isTaxable: true } }),
    db.employee.findUnique({ where: { id: employeeId }, select: { dateOfBirth: true, legalEntity: { select: { ptState: true, pfWageCeiling: true, pfEmployeePct: true } } } }),
  ]);
  if (!salary) return null;
  const byCode = new Map(comps.map((c) => [c.code, c]));
  const monthly = jsonNum(salary.monthly);
  let monthlyTaxable = 0;
  for (const [code, amt] of Object.entries(monthly)) {
    const c = byCode.get(code);
    if ((!c || c.type === "EARNING" || c.type === "REIMBURSEMENT") && (c?.isTaxable ?? true)) monthlyTaxable += amt;
  }
  const annualTaxable = Math.round(monthlyTaxable * 12);
  const declarations = decl ? (jsonNum(decl.declarations) as Partial<Record<DeclarationKey, number>>) : {};
  const age = emp?.dateOfBirth ? Math.floor((Date.now() - emp.dateOfBirth.getTime()) / (365.25 * 86_400_000)) : undefined;
  const pfWage = salary.pfApplicable ? Math.min(monthly.BASIC ?? 0, num(emp?.legalEntity?.pfWageCeiling ?? 15000)) : 0;
  const pfAnnual = Math.round((pfWage * num(emp?.legalEntity?.pfEmployeePct ?? 12)) / 100) * 12;
  const ptAnnual = salary.ptApplicable ? 12 * computeProfessionalTax(emp?.legalEntity?.ptState, Object.values(monthly).reduce((a, b) => a + b, 0), 1) : 0;
  const oldDecl = { ...declarations, "80C": (declarations["80C"] ?? 0) + pfAnnual };
  const NEW = computeAnnualTax({ regime: "NEW", annualTaxableSalary: annualTaxable, declarations, age, fy });
  const OLD = computeAnnualTax({ regime: "OLD", annualTaxableSalary: annualTaxable, declarations: oldDecl, age, annualProfessionalTax: ptAnnual, fy });
  return {
    financialYear: fy,
    annualTaxableSalary: annualTaxable,
    annualCtc: num(salary.annualCtc),
    selectedRegime: (decl?.regime ?? salary.taxRegime) as Regime,
    declarationStatus: decl?.status ?? null,
    pfAnnual,
    ptAnnual,
    NEW,
    OLD,
    recommended: NEW.totalTax <= OLD.totalTax ? ("NEW" as Regime) : ("OLD" as Regime),
    saving: Math.abs(NEW.totalTax - OLD.totalTax),
  };
}
export type TaxProjection = NonNullable<Awaited<ReturnType<typeof taxProjection>>>;

// ───────────────────────────── Misc ─────────────────────────────

export function monthLabel(month: number): string {
  return ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][month - 1] ?? String(month);
}

export async function listLegalEntities(actor: Actor) {
  if (!RUN_READ(actor)) throw new ForbiddenError("Missing permission payroll:run");
  return db.legalEntity.findMany({ select: { id: true, name: true, ptState: true, isDefault: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
}

/** Lightweight employee search for the salary-setup and adjustment screens. */
export async function searchEmployeesForPayroll(actor: Actor, q: string, limit = 10) {
  if (!can(actor, "payroll:manage") && !can(actor, "payroll:run")) throw new ForbiddenError("Missing permission payroll:manage");
  if (!q.trim()) return [];
  return db.employee.findMany({
    where: { status: { not: "EXITED" }, OR: [{ displayName: { contains: q, mode: "insensitive" } }, { employeeCode: { contains: q, mode: "insensitive" } }, { workEmail: { contains: q, mode: "insensitive" } }] },
    select: { id: true, employeeCode: true, displayName: true, department: { select: { name: true } }, designation: { select: { name: true } } },
    orderBy: { employeeCode: "asc" },
    take: Math.min(limit, 25),
  });
}
