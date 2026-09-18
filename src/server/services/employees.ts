import "server-only";
import { z } from "zod";
import Papa from "papaparse";
import { Prisma, type CalcType, type ComponentType, type EmployeeStatus, type EmploymentType, type Gender } from "@/generated/prisma/client";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { sendMail } from "@/lib/mail";
import { env } from "@/lib/env";
import { hashPassword } from "@/lib/auth/password";
import { revokeAllSessions } from "@/lib/auth/session";
import { decryptField, encryptField, mask, randomToken } from "@/lib/crypto";
import { addDays, isoDate, toDateOnly, todayUtc } from "@/lib/dates";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { type Pagination, paginate, paginationSchema, toPage, zDateOnly, zUuid } from "@/lib/api";
import { type Actor, authorize, reportsOf, visibleEmployeeIds, can } from "@/lib/rbac/authorize";
import { applyOnboardingTemplate } from "@/server/services/onboarding";

// ── Constants & schemas ────────────────────────────────────────────────

export const GENDERS = ["MALE", "FEMALE", "OTHER", "UNDISCLOSED"] as const;
export const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN", "CONSULTANT"] as const;
export const EMPLOYEE_STATUSES = ["ONBOARDING", "ACTIVE", "ON_NOTICE", "EXITED"] as const;

const addressSchema = z
  .object({
    line1: z.string().trim().max(200).optional().nullable(),
    line2: z.string().trim().max(200).optional().nullable(),
    city: z.string().trim().max(100).optional().nullable(),
    state: z.string().trim().max(100).optional().nullable(),
    pincode: z.string().trim().max(20).optional().nullable(),
    country: z.string().trim().max(60).optional().nullable(),
  })
  .partial();
export type Address = z.infer<typeof addressSchema>;

const emergencyContactSchema = z
  .object({ name: z.string().trim().max(120).optional().nullable(), relation: z.string().trim().max(60).optional().nullable(), phone: z.string().trim().max(30).optional().nullable() })
  .partial();
export type EmergencyContact = z.infer<typeof emergencyContactSchema>;

const optionalUuid = z.preprocess((v) => (v === "" ? null : v), zUuid.nullable().optional());
const optionalStr = (max: number) => z.preprocess((v) => (v === "" ? null : v), z.string().trim().max(max).nullable().optional());

/** Shared contract: the hiring module calls `createEmployee(actor, input)` with exactly this shape. */
export const createEmployeeSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  middleName: optionalStr(80),
  workEmail: z.string().trim().toLowerCase().email().max(200),
  personalEmail: z.preprocess((v) => (v === "" ? null : v), z.string().trim().toLowerCase().email().max(200).nullable().optional()),
  phone: optionalStr(30),
  dateOfBirth: z.preprocess((v) => (v === "" ? undefined : v), z.union([zDateOnly, z.date()]).optional()),
  gender: z.enum(GENDERS).optional(),
  joiningDate: z.union([zDateOnly, z.date()]),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  departmentId: optionalUuid,
  designationId: optionalUuid,
  locationId: optionalUuid,
  legalEntityId: optionalUuid,
  managerId: optionalUuid,
  shiftId: optionalUuid,
  annualCtc: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().min(0).max(1_000_000_000).optional()),
  createUser: z.boolean().default(true),
  roleKeys: z.array(z.string().min(1).max(60)).default(["EMPLOYEE"]),
  sendInvite: z.boolean().default(false),
  onboardingTemplateId: optionalUuid,
  probationMonths: z.coerce.number().int().min(0).max(24).optional(),
  noticePeriodDays: z.coerce.number().int().min(0).max(365).optional(),
});
export type CreateEmployeeInput = z.input<typeof createEmployeeSchema>;

export interface CreateEmployeeResult {
  id: string;
  employeeCode: string;
  userId: string | null;
  tempPassword?: string;
}

const SELF_EDITABLE = ["personalEmail", "phone", "currentAddress", "permanentAddress", "emergencyContact", "photoUrl", "maritalStatus", "bloodGroup"] as const;
const JOB_FIELDS = ["departmentId", "designationId", "managerId", "employmentType", "locationId"] as const;

export const updateEmployeeSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    middleName: optionalStr(80),
    workEmail: z.string().trim().toLowerCase().email().max(200),
    personalEmail: z.preprocess((v) => (v === "" ? null : v), z.string().trim().toLowerCase().email().max(200).nullable()),
    phone: optionalStr(30),
    dateOfBirth: z.preprocess((v) => (v === "" ? null : v), zDateOnly.nullable()),
    gender: z.enum(GENDERS),
    maritalStatus: optionalStr(40),
    bloodGroup: optionalStr(10),
    photoUrl: optionalStr(500),
    joiningDate: zDateOnly,
    confirmationDate: z.preprocess((v) => (v === "" ? null : v), zDateOnly.nullable()),
    probationMonths: z.coerce.number().int().min(0).max(24),
    noticePeriodDays: z.coerce.number().int().min(0).max(365),
    legalEntityId: optionalUuid,
    shiftId: optionalUuid,
    pfNumber: optionalStr(40),
    esiNumber: optionalStr(40),
    currentAddress: addressSchema.nullable(),
    permanentAddress: addressSchema.nullable(),
    emergencyContact: emergencyContactSchema.nullable(),
    customFields: z.record(z.string(), z.unknown()),
    status: z.enum(["ONBOARDING", "ACTIVE"]),
    // Job change (appends JobHistory)
    departmentId: optionalUuid,
    designationId: optionalUuid,
    managerId: optionalUuid,
    employmentType: z.enum(EMPLOYMENT_TYPES),
    locationId: optionalUuid,
    effectiveFrom: zDateOnly,
    reason: z.string().trim().min(1).max(200),
    note: optionalStr(2000),
  })
  .partial();
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const updateSensitiveSchema = z.object({
  pan: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN must look like ABCDE1234F").optional()),
  aadhaar: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().regex(/^\d{12}$/, "Aadhaar must be 12 digits").optional()),
  uan: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().regex(/^\d{12}$/, "UAN must be 12 digits").optional()),
  bank: z
    .object({
      accountHolder: z.string().trim().min(1).max(120),
      accountNumber: z.string().trim().regex(/^[0-9]{6,20}$/, "Account number must be 6-20 digits"),
      ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC"),
      bankName: z.string().trim().min(1).max(120),
      branch: optionalStr(120),
    })
    .optional(),
});
export type UpdateSensitiveInput = z.infer<typeof updateSensitiveSchema>;

export const exitEmployeeSchema = z.object({ exitDate: zDateOnly, reason: z.string().trim().min(1).max(500) });

export const listEmployeesSchema = paginationSchema.extend({
  departmentId: zUuid.optional(),
  locationId: zUuid.optional(),
  designationId: zUuid.optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  managerId: zUuid.optional(),
  format: z.enum(["json", "csv"]).optional(),
});
export type ListEmployeesParams = z.infer<typeof listEmployeesSchema>;

// ── Pure helpers (unit-testable) ───────────────────────────────────────

export interface StructureLineLite {
  code: string;
  type: ComponentType;
  calcType: CalcType;
  value: number;
  order: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Computes monthly component amounts from an annual CTC and a salary structure.
 * PERCENT_OF_CTC → monthlyCtc*value/100; PERCENT_OF_BASIC → basic*value/100;
 * FIXED → value; BALANCE → remainder of monthly CTC. PERCENT_OF_GROSS is
 * approximated as percent of monthly CTC (gross is not known until earnings are set).
 */
export function computeMonthlyFromStructure(annualCtc: number, lines: StructureLineLite[]): { monthly: Record<string, number>; gross: number } {
  const monthlyCtc = annualCtc / 12;
  const sorted = [...lines].sort((a, b) => a.order - b.order);
  const monthly: Record<string, number> = {};
  for (const l of sorted) {
    if (l.calcType === "PERCENT_OF_CTC") monthly[l.code] = r2((monthlyCtc * l.value) / 100);
    else if (l.calcType === "FIXED") monthly[l.code] = r2(l.value);
    else if (l.calcType === "PERCENT_OF_GROSS") monthly[l.code] = r2((monthlyCtc * l.value) / 100);
  }
  const basic = monthly.BASIC ?? monthly[sorted.find((l) => l.calcType === "PERCENT_OF_CTC")?.code ?? ""] ?? 0;
  for (const l of sorted) if (l.calcType === "PERCENT_OF_BASIC") monthly[l.code] = r2((basic * l.value) / 100);
  const ctcPart = sorted.filter((l) => l.calcType !== "BALANCE" && (l.type === "EARNING" || l.type === "EMPLOYER_CONTRIBUTION"));
  const allocated = ctcPart.reduce((s, l) => s + (monthly[l.code] ?? 0), 0);
  const balanceLines = sorted.filter((l) => l.calcType === "BALANCE");
  if (balanceLines.length) {
    const remainder = Math.max(0, r2(monthlyCtc - allocated));
    balanceLines.forEach((l, i) => (monthly[l.code] = i === 0 ? remainder : 0));
  }
  const gross = sorted.filter((l) => l.type === "EARNING").reduce((s, l) => s + (monthly[l.code] ?? 0), 0);
  return { monthly, gross: r2(gross) };
}

/** Accrual credited for `year` on joining: pro-rated by remaining months for accruing types, full quota otherwise. */
export function initialLeaveAccrual(lt: { annualQuota: number; accrualPerMonth: number }, joiningDate: Date, year: number): number {
  if (lt.accrualPerMonth <= 0) return lt.annualQuota;
  const jy = joiningDate.getUTCFullYear();
  const months = jy < year ? 12 : jy > year ? 0 : 12 - joiningDate.getUTCMonth();
  const accrued = r2(lt.accrualPerMonth * months);
  return lt.annualQuota > 0 ? Math.min(lt.annualQuota, accrued) : accrued;
}

/** ONBOARDING when joining in the future or within the last 30 days, else ACTIVE. */
export function initialStatus(joiningDate: Date, today = todayUtc()): EmployeeStatus {
  return toDateOnly(joiningDate).getTime() >= addDays(today, -30).getTime() ? "ONBOARDING" : "ACTIVE";
}

export function employeeCodePrefix(orgName: string | null | undefined): string {
  const words = (orgName ?? "").trim().split(/\s+/).filter(Boolean);
  const initials = words.map((w) => w[0]).join("").toUpperCase().replace(/[^A-Z]/g, "");
  if (initials.length >= 2) return initials.slice(0, 3);
  const first = (words[0] ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  return first.length >= 3 ? first.slice(0, 3) : "EMP";
}

function tempPassword(): string {
  // 16 chars, satisfies the letters+numbers policy.
  return `Hr${randomToken(9).replace(/[-_]/g, "x")}7`;
}

async function allowed(actor: Actor, permission: Parameters<typeof authorize>[1], employeeId: string): Promise<boolean> {
  try {
    await authorize(actor, permission, { employeeId });
    return true;
  } catch {
    return false;
  }
}

async function nextEmployeeCode(tx: Tx): Promise<string> {
  const org = await tx.organization.findFirst({ select: { name: true } });
  const prefix = employeeCodePrefix(org?.name);
  const last = await tx.employee.findFirst({ where: { employeeCode: { startsWith: prefix } }, orderBy: { employeeCode: "desc" }, select: { employeeCode: true } });
  const m = last?.employeeCode.match(/(\d+)$/);
  let seq = m ? Number(m[1]) + 1 : (await tx.employee.count()) + 1;
  for (let i = 0; i < 50; i++) {
    const code = `${prefix}${String(seq).padStart(5, "0")}`;
    if (!(await tx.employee.findUnique({ where: { employeeCode: code }, select: { id: true } }))) return code;
    seq++;
  }
  throw new ConflictError("Could not allocate a unique employee code");
}

async function ensureManagerRole(tx: Tx, managerEmployeeId: string | null | undefined) {
  if (!managerEmployeeId) return;
  const mgr = await tx.employee.findUnique({ where: { id: managerEmployeeId }, select: { userId: true } });
  if (!mgr?.userId) return;
  const role = await tx.role.findUnique({ where: { key: "MANAGER" }, select: { id: true } });
  if (!role) return;
  await tx.userRole.upsert({ where: { userId_roleId: { userId: mgr.userId, roleId: role.id } }, update: {}, create: { userId: mgr.userId, roleId: role.id } });
}

// ── Directory ──────────────────────────────────────────────────────────

export interface EmployeeListItem {
  id: string;
  employeeCode: string;
  displayName: string;
  workEmail: string;
  phone: string | null;
  photoUrl: string | null;
  status: EmployeeStatus;
  employmentType: EmploymentType;
  joiningDate: string;
  designation: string | null;
  department: string | null;
  location: string | null;
  manager: { id: string; displayName: string } | null;
}

export async function listEmployees(actor: Actor, params: Partial<ListEmployeesParams> & Pick<Pagination, "page" | "pageSize">) {
  const p = { ...paginationSchema.parse({}), ...params };
  const ids = await visibleEmployeeIds(actor, "employees:read");
  if (ids !== null && ids.length === 0) return toPage<EmployeeListItem>([], 0, p);
  const where: Prisma.EmployeeWhereInput = {
    ...(ids ? { id: { in: ids } } : {}),
    ...(p.departmentId ? { departmentId: p.departmentId } : {}),
    ...(p.locationId ? { locationId: p.locationId } : {}),
    ...(p.designationId ? { designationId: p.designationId } : {}),
    ...(p.managerId ? { managerId: p.managerId } : {}),
    ...(p.status ? { status: p.status } : { status: { not: "EXITED" } }),
  };
  if (p.q) {
    const q = p.q.trim();
    where.OR = [
      { displayName: { contains: q, mode: "insensitive" } },
      { employeeCode: { contains: q, mode: "insensitive" } },
      { workEmail: { contains: q, mode: "insensitive" } },
    ];
  }
  const orderBy: Prisma.EmployeeOrderByWithRelationInput[] =
    p.sort === "joiningDate" ? [{ joiningDate: p.order }] : p.sort === "code" ? [{ employeeCode: p.order }] : [{ lastName: p.order }, { firstName: p.order }];
  const [rows, total] = await Promise.all([
    db.employee.findMany({
      where,
      orderBy,
      ...paginate(p),
      select: {
        id: true,
        employeeCode: true,
        displayName: true,
        workEmail: true,
        phone: true,
        photoUrl: true,
        status: true,
        employmentType: true,
        joiningDate: true,
        designation: { select: { name: true } },
        department: { select: { name: true } },
        location: { select: { name: true } },
        manager: { select: { id: true, displayName: true } },
      },
    }),
    db.employee.count({ where }),
  ]);
  const items: EmployeeListItem[] = rows.map((r) => ({
    id: r.id,
    employeeCode: r.employeeCode,
    displayName: r.displayName,
    workEmail: r.workEmail,
    phone: r.phone,
    photoUrl: r.photoUrl,
    status: r.status,
    employmentType: r.employmentType,
    joiningDate: isoDate(r.joiningDate),
    designation: r.designation?.name ?? null,
    department: r.department?.name ?? null,
    location: r.location?.name ?? null,
    manager: r.manager,
  }));
  return toPage(items, total, p);
}

/** CSV export of the directory (up to 5000 rows). Requires `reports:export`. */
export async function exportEmployeesCsv(actor: Actor, params: Partial<ListEmployeesParams>): Promise<string> {
  await authorize(actor, "reports:export");
  const page = await listEmployees(actor, { ...params, page: 1, pageSize: 200 });
  const all = [...page.items];
  for (let n = 2; n <= Math.min(page.pages, 25); n++) all.push(...(await listEmployees(actor, { ...params, page: n, pageSize: 200 })).items);
  await audit(actor, "employees.export", "Employee", null, { after: { rows: all.length } });
  return Papa.unparse(
    all.map((e) => ({
      employeeCode: e.employeeCode,
      name: e.displayName,
      workEmail: e.workEmail,
      phone: e.phone ?? "",
      designation: e.designation ?? "",
      department: e.department ?? "",
      location: e.location ?? "",
      manager: e.manager?.displayName ?? "",
      employmentType: e.employmentType,
      status: e.status,
      joiningDate: e.joiningDate,
    })),
  );
}

export async function listReports(actor: Actor, managerId: string) {
  await authorize(actor, "employees:read", { employeeId: managerId });
  const rows = await db.employee.findMany({
    where: { managerId, status: { not: "EXITED" } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 200,
    select: { id: true, employeeCode: true, displayName: true, workEmail: true, photoUrl: true, status: true, designation: { select: { name: true } }, department: { select: { name: true } } },
  });
  return rows.map((r) => ({ ...r, designation: r.designation?.name ?? null, department: r.department?.name ?? null }));
}

// ── Profile ────────────────────────────────────────────────────────────

export interface Named {
  id: string;
  name: string;
}
export interface EmployeeProfile {
  id: string;
  employeeCode: string;
  userId: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  displayName: string;
  workEmail: string;
  personalEmail: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  gender: Gender;
  maritalStatus: string | null;
  bloodGroup: string | null;
  photoUrl: string | null;
  joiningDate: string;
  confirmationDate: string | null;
  probationMonths: number;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  exitDate: string | null;
  exitReason: string | null;
  noticePeriodDays: number;
  departmentId: string | null;
  department: Named | null;
  designationId: string | null;
  designation: Named | null;
  locationId: string | null;
  location: Named | null;
  legalEntityId: string | null;
  legalEntity: Named | null;
  managerId: string | null;
  manager: { id: string; displayName: string; employeeCode: string } | null;
  shiftId: string | null;
  shift: Named | null;
  currentAddress: Address | null;
  permanentAddress: Address | null;
  emergencyContact: EmergencyContact | null;
  customFields: Record<string, unknown>;
  pfNumber: string | null;
  esiNumber: string | null;
  sensitive: {
    unmasked: boolean;
    pan: string | null;
    aadhaar: string | null;
    uan: string | null;
    bank: { accountHolder: string; accountNumber: string; ifsc: string; bankName: string; branch: string | null; verifiedAt: string | null } | null;
  };
  jobHistory: { id: string; effectiveFrom: string; department: string | null; designation: string | null; manager: string | null; employmentType: EmploymentType | null; annualCtc: number | null; reason: string; note: string | null }[];
  reportCount: number;
  user: { status: string; lastLoginAt: string | null; mustChangePassword: boolean } | null;
  createdAt: string;
}

export async function getEmployee(actor: Actor, id: string): Promise<EmployeeProfile> {
  await authorize(actor, "employees:read", { employeeId: id });
  const e = await db.employee.findUnique({
    where: { id },
    include: {
      department: { select: { id: true, name: true } },
      designation: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
      legalEntity: { select: { id: true, name: true } },
      shift: { select: { id: true, name: true } },
      manager: { select: { id: true, displayName: true, employeeCode: true } },
      bankAccount: true,
      user: { select: { status: true, lastLoginAt: true, mustChangePassword: true } },
      jobHistory: { orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }], take: 50, include: { department: { select: { name: true } }, designation: { select: { name: true } } } },
      _count: { select: { reports: { where: { status: { not: "EXITED" } } } } },
    },
  });
  if (!e) throw new NotFoundError("Employee");
  const unmasked = await allowed(actor, "employees:read_sensitive", id);
  const mgrIds = [...new Set(e.jobHistory.map((j) => j.managerId).filter((x): x is string => Boolean(x)))];
  const mgrs = mgrIds.length ? await db.employee.findMany({ where: { id: { in: mgrIds } }, select: { id: true, displayName: true } }) : [];
  const mgrName = new Map(mgrs.map((m) => [m.id, m.displayName]));
  const reveal = (enc: string | null) => {
    const v = decryptField(enc);
    return unmasked ? v : mask(v);
  };
  const acct = e.bankAccount ? (unmasked ? decryptField(e.bankAccount.accountNumberEnc) : `${"*".repeat(8)}${e.bankAccount.accountLast4}`) : null;
  return {
    id: e.id,
    employeeCode: e.employeeCode,
    userId: e.userId,
    firstName: e.firstName,
    middleName: e.middleName,
    lastName: e.lastName,
    displayName: e.displayName,
    workEmail: e.workEmail,
    personalEmail: e.personalEmail,
    phone: e.phone,
    dateOfBirth: e.dateOfBirth ? isoDate(e.dateOfBirth) : null,
    gender: e.gender,
    maritalStatus: e.maritalStatus,
    bloodGroup: e.bloodGroup,
    photoUrl: e.photoUrl,
    joiningDate: isoDate(e.joiningDate),
    confirmationDate: e.confirmationDate ? isoDate(e.confirmationDate) : null,
    probationMonths: e.probationMonths,
    employmentType: e.employmentType,
    status: e.status,
    exitDate: e.exitDate ? isoDate(e.exitDate) : null,
    exitReason: e.exitReason,
    noticePeriodDays: e.noticePeriodDays,
    departmentId: e.departmentId,
    department: e.department,
    designationId: e.designationId,
    designation: e.designation,
    locationId: e.locationId,
    location: e.location,
    legalEntityId: e.legalEntityId,
    legalEntity: e.legalEntity,
    managerId: e.managerId,
    manager: e.manager,
    shiftId: e.shiftId,
    shift: e.shift,
    currentAddress: (e.currentAddress as Address | null) ?? null,
    permanentAddress: (e.permanentAddress as Address | null) ?? null,
    emergencyContact: (e.emergencyContact as EmergencyContact | null) ?? null,
    customFields: (e.customFields as Record<string, unknown>) ?? {},
    pfNumber: e.pfNumber,
    esiNumber: e.esiNumber,
    sensitive: {
      unmasked,
      pan: reveal(e.panEnc),
      aadhaar: reveal(e.aadhaarEnc),
      uan: reveal(e.uanEnc),
      bank: e.bankAccount
        ? { accountHolder: e.bankAccount.accountHolder, accountNumber: acct ?? "", ifsc: e.bankAccount.ifsc, bankName: e.bankAccount.bankName, branch: e.bankAccount.branch, verifiedAt: e.bankAccount.verifiedAt?.toISOString() ?? null }
        : null,
    },
    jobHistory: e.jobHistory.map((j) => ({
      id: j.id,
      effectiveFrom: isoDate(j.effectiveFrom),
      department: j.department?.name ?? null,
      designation: j.designation?.name ?? null,
      manager: j.managerId ? (mgrName.get(j.managerId) ?? null) : null,
      employmentType: j.employmentType,
      annualCtc: j.annualCtc === null ? null : Number(j.annualCtc),
      reason: j.reason,
      note: j.note,
    })),
    reportCount: e._count.reports,
    user: e.user ? { status: e.user.status, lastLoginAt: e.user.lastLoginAt?.toISOString() ?? null, mustChangePassword: e.user.mustChangePassword } : null,
    createdAt: e.createdAt.toISOString(),
  };
}

// ── Create ─────────────────────────────────────────────────────────────

export async function createEmployee(actor: Actor, rawInput: CreateEmployeeInput): Promise<CreateEmployeeResult> {
  // Creating an employee needs org-wide employees:write, or hiring:manage (recruiters converting an accepted offer).
  if (!can(actor, "hiring:manage", "ALL")) await authorize(actor, "employees:write", { minScope: "ALL" });
  return createEmployeeInternal(actor, rawInput);
}

async function createEmployeeInternal(actor: Actor, rawInput: CreateEmployeeInput): Promise<CreateEmployeeResult> {
  const input = createEmployeeSchema.parse(rawInput);
  const joiningDate = toDateOnly(input.joiningDate);
  const dateOfBirth = input.dateOfBirth ? toDateOnly(input.dateOfBirth) : null;

  if (await db.employee.findUnique({ where: { workEmail: input.workEmail }, select: { id: true } })) throw new ConflictError(`An employee with work email ${input.workEmail} already exists`);
  if (input.createUser && (await db.user.findUnique({ where: { email: input.workEmail }, select: { id: true } }))) throw new ConflictError(`A user with email ${input.workEmail} already exists`);
  if (input.managerId && !(await db.employee.findUnique({ where: { id: input.managerId }, select: { id: true } }))) throw new ValidationError("Manager not found");

  const roleKeys = input.roleKeys.length ? [...new Set(input.roleKeys)] : ["EMPLOYEE"];
  const roles = input.createUser ? await db.role.findMany({ where: { key: { in: roleKeys } }, select: { id: true, key: true } }) : [];
  if (input.createUser) {
    const missing = roleKeys.filter((k) => !roles.some((r) => r.key === k));
    if (missing.length) throw new ValidationError(`Unknown roles: ${missing.join(", ")}`);
  }
  const plain = input.createUser ? tempPassword() : null;
  const passwordHash = plain ? await hashPassword(plain) : null;
  const displayName = [input.firstName, input.middleName, input.lastName].filter(Boolean).join(" ");
  const status = initialStatus(joiningDate);
  const year = todayUtc().getUTCFullYear();

  const result = await db.$transaction(
    async (tx) => {
      const [legalEntity, shift, structure, leaveTypes] = await Promise.all([
        input.legalEntityId ? null : tx.legalEntity.findFirst({ where: { isDefault: true }, select: { id: true } }),
        input.shiftId ? null : tx.shift.findFirst({ where: { isDefault: true }, select: { id: true } }),
        input.annualCtc ? tx.salaryStructure.findFirst({ where: { isDefault: true }, include: { lines: { include: { component: { select: { code: true, type: true } } } } } }) : null,
        tx.leaveType.findMany({ where: { isActive: true }, select: { id: true, annualQuota: true, accrualPerMonth: true, applicableGender: true } }),
      ]);
      const employeeCode = await nextEmployeeCode(tx);

      const user = input.createUser
        ? await tx.user.create({
            data: {
              email: input.workEmail,
              name: displayName,
              passwordHash,
              status: "INVITED",
              mustChangePassword: true,
              roles: { create: roles.map((r) => ({ roleId: r.id })) },
            },
            select: { id: true },
          })
        : null;

      const emp = await tx.employee.create({
        data: {
          employeeCode,
          userId: user?.id ?? null,
          firstName: input.firstName,
          middleName: input.middleName ?? null,
          lastName: input.lastName,
          displayName,
          workEmail: input.workEmail,
          personalEmail: input.personalEmail ?? null,
          phone: input.phone ?? null,
          dateOfBirth,
          gender: input.gender ?? "UNDISCLOSED",
          joiningDate,
          employmentType: input.employmentType ?? "FULL_TIME",
          status,
          probationMonths: input.probationMonths ?? 6,
          noticePeriodDays: input.noticePeriodDays ?? 60,
          departmentId: input.departmentId ?? null,
          designationId: input.designationId ?? null,
          locationId: input.locationId ?? null,
          legalEntityId: input.legalEntityId ?? legalEntity?.id ?? null,
          managerId: input.managerId ?? null,
          shiftId: input.shiftId ?? shift?.id ?? null,
        },
        select: { id: true },
      });

      await tx.jobHistory.create({
        data: {
          employeeId: emp.id,
          effectiveFrom: joiningDate,
          departmentId: input.departmentId ?? null,
          designationId: input.designationId ?? null,
          managerId: input.managerId ?? null,
          employmentType: input.employmentType ?? "FULL_TIME",
          annualCtc: input.annualCtc ?? null,
          reason: "Joined",
        },
      });

      if (input.annualCtc && input.annualCtc > 0) {
        const lines: StructureLineLite[] = (structure?.lines ?? []).map((l) => ({ code: l.component.code, type: l.component.type, calcType: l.calcType, value: Number(l.value), order: l.order }));
        const { monthly, gross } = computeMonthlyFromStructure(input.annualCtc, lines);
        await tx.employeeSalary.create({
          data: {
            employeeId: emp.id,
            structureId: structure?.id ?? null,
            effectiveFrom: joiningDate,
            annualCtc: input.annualCtc,
            monthly,
            pfApplicable: true,
            esiApplicable: gross <= 21000,
            ptApplicable: true,
            isCurrent: true,
          },
        });
      }

      const gender = input.gender ?? "UNDISCLOSED";
      const balances = leaveTypes
        .filter((lt) => !lt.applicableGender || lt.applicableGender === gender)
        .map((lt) => ({
          employeeId: emp.id,
          leaveTypeId: lt.id,
          year,
          opening: 0,
          accrued: initialLeaveAccrual({ annualQuota: Number(lt.annualQuota), accrualPerMonth: Number(lt.accrualPerMonth) }, joiningDate, year),
        }));
      if (balances.length) await tx.leaveBalance.createMany({ data: balances, skipDuplicates: true });

      await applyOnboardingTemplate(tx, emp.id, joiningDate, input.onboardingTemplateId ?? undefined);
      await ensureManagerRole(tx, input.managerId);

      return { id: emp.id, employeeCode, userId: user?.id ?? null };
    },
    { timeout: 30_000 },
  );

  await audit(actor, "employees.create", "Employee", result.id, { after: { ...input, employeeCode: result.employeeCode } });
  if (input.managerId) {
    await notify({ employeeId: input.managerId, type: "employees", title: `${displayName} will report to you`, body: `Joining on ${isoDate(joiningDate)}. Onboarding tasks assigned to you are on your profile page.`, link: `/employees/${result.id}` });
  }
  if (input.sendInvite && plain) {
    await sendMail({
      to: input.workEmail,
      subject: "Welcome to HRsoft — your account",
      text: `Hi ${input.firstName},\n\nYour HRsoft account is ready.\n\nSign in: ${env().APP_URL}/login\nEmail: ${input.workEmail}\nTemporary password: ${plain}\n\nYou will be asked to change it on first sign-in.`,
    });
  }
  return { ...result, ...(plain ? { tempPassword: plain } : {}) };
}

// ── Update ─────────────────────────────────────────────────────────────

export async function updateEmployee(actor: Actor, id: string, patch: UpdateEmployeeInput) {
  const before = await db.employee.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Employee");
  const keys = Object.keys(patch).filter((k) => patch[k as keyof UpdateEmployeeInput] !== undefined) as (keyof UpdateEmployeeInput)[];
  const isSelf = actor.employeeId === id;
  const onlySelfFields = keys.every((k) => (SELF_EDITABLE as readonly string[]).includes(k));
  if (!(isSelf && onlySelfFields)) await authorize(actor, "employees:write", { employeeId: id });
  if (keys.length === 0) return getEmployee(actor, id);

  const jobChanged = JOB_FIELDS.filter((f) => patch[f] !== undefined && patch[f] !== before[f]);
  if (patch.managerId !== undefined && patch.managerId !== null && patch.managerId !== before.managerId) {
    if (patch.managerId === id) throw new ValidationError("An employee cannot report to themselves");
    if ((await reportsOf(id)).has(patch.managerId)) throw new ValidationError("Manager cannot be one of this employee's own reports");
    if (!(await db.employee.findUnique({ where: { id: patch.managerId }, select: { id: true } }))) throw new ValidationError("Manager not found");
  }
  if (patch.workEmail && patch.workEmail !== before.workEmail) {
    if (await db.employee.findUnique({ where: { workEmail: patch.workEmail }, select: { id: true } })) throw new ConflictError("Work email already in use");
  }

  const { effectiveFrom, reason, note, ...fields } = patch;
  const firstName = fields.firstName ?? before.firstName;
  const lastName = fields.lastName ?? before.lastName;
  const middleName = fields.middleName === undefined ? before.middleName : fields.middleName;
  const data: Prisma.EmployeeUncheckedUpdateInput = {
    ...fields,
    displayName: [firstName, middleName, lastName].filter(Boolean).join(" "),
    currentAddress: fields.currentAddress === undefined ? undefined : fields.currentAddress === null ? Prisma.DbNull : (fields.currentAddress as Prisma.InputJsonValue),
    permanentAddress: fields.permanentAddress === undefined ? undefined : fields.permanentAddress === null ? Prisma.DbNull : (fields.permanentAddress as Prisma.InputJsonValue),
    emergencyContact: fields.emergencyContact === undefined ? undefined : fields.emergencyContact === null ? Prisma.DbNull : (fields.emergencyContact as Prisma.InputJsonValue),
    customFields: fields.customFields === undefined ? undefined : (fields.customFields as Prisma.InputJsonValue),
  };

  await db.$transaction(async (tx) => {
    await tx.employee.update({ where: { id }, data });
    if (jobChanged.length) {
      await tx.jobHistory.create({
        data: {
          employeeId: id,
          effectiveFrom: effectiveFrom ?? todayUtc(),
          departmentId: patch.departmentId === undefined ? before.departmentId : patch.departmentId,
          designationId: patch.designationId === undefined ? before.designationId : patch.designationId,
          managerId: patch.managerId === undefined ? before.managerId : patch.managerId,
          employmentType: patch.employmentType ?? before.employmentType,
          reason: reason ?? `Changed ${jobChanged.join(", ")}`,
          note: note ?? null,
        },
      });
      if (jobChanged.includes("managerId")) await ensureManagerRole(tx, patch.managerId);
    }
    if (fields.workEmail && fields.workEmail !== before.workEmail && before.userId) {
      await tx.user.update({ where: { id: before.userId }, data: { email: fields.workEmail } });
    }
    if ((fields.firstName || fields.lastName || fields.middleName !== undefined) && before.userId) {
      await tx.user.update({ where: { id: before.userId }, data: { name: data.displayName as string } });
    }
  });

  const after = Object.fromEntries(keys.map((k) => [k, patch[k]]));
  const prev = Object.fromEntries(keys.map((k) => [k, (before as Record<string, unknown>)[k]]));
  await audit(actor, jobChanged.length ? "employees.job_change" : "employees.update", "Employee", id, { before: prev, after });
  if (jobChanged.includes("managerId") && patch.managerId) {
    await notify({ employeeId: patch.managerId, type: "employees", title: `${before.displayName} now reports to you`, link: `/employees/${id}` });
  }
  if (jobChanged.length && !isSelf) {
    await notify({ employeeId: id, type: "employees", title: "Your job details were updated", body: reason ?? `Changed ${jobChanged.join(", ")}`, link: "/me?tab=job" });
  }
  return getEmployee(actor, id);
}

/** PAN / Aadhaar / UAN / bank: HR (`employees:write`) or the employee themselves. */
export async function updateSensitive(actor: Actor, id: string, input: UpdateSensitiveInput) {
  const emp = await db.employee.findUnique({ where: { id }, select: { id: true, status: true, bankAccount: { select: { id: true } } } });
  if (!emp) throw new NotFoundError("Employee");
  const isSelf = actor.employeeId === id;
  if (!isSelf) await authorize(actor, "employees:write", { employeeId: id });
  if (input.pan === undefined && input.aadhaar === undefined && input.uan === undefined && !input.bank) throw new ValidationError("Nothing to update");

  await db.$transaction(async (tx) => {
    await tx.employee.update({
      where: { id },
      data: {
        ...(input.pan !== undefined ? { panEnc: encryptField(input.pan) } : {}),
        ...(input.aadhaar !== undefined ? { aadhaarEnc: encryptField(input.aadhaar) } : {}),
        ...(input.uan !== undefined ? { uanEnc: encryptField(input.uan) } : {}),
      },
    });
    if (input.bank) {
      const b = input.bank;
      const row = { accountHolder: b.accountHolder, accountNumberEnc: encryptField(b.accountNumber), accountLast4: b.accountNumber.slice(-4), ifsc: b.ifsc, bankName: b.bankName, branch: b.branch ?? null, verifiedAt: isSelf ? null : new Date() };
      await tx.bankAccount.upsert({ where: { employeeId: id }, update: row, create: { employeeId: id, ...row } });
    }
  });
  await audit(actor, "employees.update_sensitive", "Employee", id, { after: { pan: input.pan ? "[set]" : undefined, aadhaar: input.aadhaar ? "[set]" : undefined, uan: input.uan ? "[set]" : undefined, bank: input.bank ? { ifsc: input.bank.ifsc, bankName: input.bank.bankName, last4: input.bank.accountNumber.slice(-4) } : undefined } });
  if (isSelf && input.bank) {
    // Let HR know a self-service bank update needs verification.
    const hr = await db.user.findMany({ where: { roles: { some: { role: { key: "HR_ADMIN" } } }, status: "ACTIVE" }, select: { id: true }, take: 5 });
    await Promise.all(hr.map((u) => notify({ userId: u.id, type: "employees", title: `${actor.name} updated their bank account`, body: "Please verify the new details.", link: `/employees/${id}?tab=bank` })));
  }
  return getEmployee(actor, id);
}

// ── Exit ───────────────────────────────────────────────────────────────

export async function exitEmployee(actor: Actor, id: string, input: { exitDate: Date; reason: string }) {
  await authorize(actor, "employees:delete", { employeeId: id });
  const emp = await db.employee.findUnique({ where: { id }, select: { id: true, userId: true, status: true, displayName: true } });
  if (!emp) throw new NotFoundError("Employee");
  if (emp.status === "EXITED") throw new ConflictError("Employee has already exited");
  const exitDate = toDateOnly(input.exitDate);
  const immediate = exitDate.getTime() <= todayUtc().getTime();
  const status: EmployeeStatus = immediate ? "EXITED" : "ON_NOTICE";
  await db.$transaction(async (tx) => {
    await tx.employee.update({ where: { id }, data: { status, exitDate, exitReason: input.reason } });
    await tx.jobHistory.create({ data: { employeeId: id, effectiveFrom: exitDate, reason: immediate ? "Exited" : "Notice period", note: input.reason } });
    if (immediate && emp.userId) await tx.user.update({ where: { id: emp.userId }, data: { status: "SUSPENDED" } });
    await tx.exitRequest.updateMany({ where: { employeeId: id, status: "PENDING" }, data: { status: "APPROVED", decidedAt: new Date(), decisionNote: "Closed by HR exit" } });
  });
  if (immediate && emp.userId) await revokeAllSessions(emp.userId);
  await audit(actor, "employees.exit", "Employee", id, { before: { status: emp.status }, after: { status, exitDate, reason: input.reason } });
  if (!immediate) await notify({ employeeId: id, type: "exits", title: "Your exit has been recorded", body: `Last working day: ${isoDate(exitDate)}`, link: "/me?tab=job", email: true });
  return getEmployee(actor, id);
}

// ── CSV import ─────────────────────────────────────────────────────────

export const IMPORT_COLUMNS = ["firstName", "lastName", "workEmail", "joiningDate", "departmentCode", "designationName", "locationName", "managerEmail", "annualCtc", "phone", "gender", "employmentType"] as const;

export interface ImportRowResult {
  row: number;
  ok: boolean;
  errors: string[];
  workEmail: string;
  name: string;
  employeeCode?: string;
  id?: string;
}

export async function importEmployeesCsv(actor: Actor, csvText: string, opts: { commit: boolean } = { commit: false }): Promise<{ rows: ImportRowResult[]; valid: number; invalid: number; created: number; committed: boolean }> {
  await authorize(actor, "employees:import", { minScope: "ALL" });
  const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  if (parsed.errors.length && parsed.data.length === 0) throw new ValidationError("Could not parse CSV", parsed.errors.map((e) => e.message));
  if (parsed.data.length === 0) throw new ValidationError("CSV has no data rows");
  if (parsed.data.length > 1000) throw new ValidationError("Import at most 1000 rows at a time");

  const [departments, designations, locations] = await Promise.all([
    db.department.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true } }),
    db.designation.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    db.location.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
  ]);
  const deptByCode = new Map(departments.map((d) => [d.code.toUpperCase(), d.id]));
  const deptByName = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]));
  const desigByName = new Map(designations.map((d) => [d.name.toLowerCase(), d.id]));
  const locByName = new Map(locations.map((l) => [l.name.toLowerCase(), l.id]));

  const emails = parsed.data.map((r) => (r.workEmail ?? "").trim().toLowerCase()).filter(Boolean);
  const managerEmails = parsed.data.map((r) => (r.managerEmail ?? "").trim().toLowerCase()).filter(Boolean);
  const [existing, managers] = await Promise.all([
    db.employee.findMany({ where: { workEmail: { in: emails } }, select: { workEmail: true } }),
    db.employee.findMany({ where: { workEmail: { in: managerEmails } }, select: { id: true, workEmail: true } }),
  ]);
  const existingSet = new Set(existing.map((e) => e.workEmail));
  const managerByEmail = new Map(managers.map((m) => [m.workEmail, m.id]));
  const seen = new Set<string>();

  const prepared: { result: ImportRowResult; input?: CreateEmployeeInput }[] = parsed.data.map((raw, i) => {
    const r = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, (v ?? "").toString().trim()]));
    const errors: string[] = [];
    const email = r.workEmail.toLowerCase();
    if (!r.firstName) errors.push("firstName is required");
    if (!r.lastName) errors.push("lastName is required");
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push("workEmail is invalid");
    else if (existingSet.has(email)) errors.push("workEmail already exists");
    else if (seen.has(email)) errors.push("workEmail is duplicated in the file");
    seen.add(email);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.joiningDate) || Number.isNaN(Date.parse(r.joiningDate))) errors.push("joiningDate must be YYYY-MM-DD");
    const departmentId = r.departmentCode ? (deptByCode.get(r.departmentCode.toUpperCase()) ?? deptByName.get(r.departmentCode.toLowerCase())) : undefined;
    if (r.departmentCode && !departmentId) errors.push(`Unknown department "${r.departmentCode}"`);
    const designationId = r.designationName ? desigByName.get(r.designationName.toLowerCase()) : undefined;
    if (r.designationName && !designationId) errors.push(`Unknown designation "${r.designationName}"`);
    const locationId = r.locationName ? locByName.get(r.locationName.toLowerCase()) : undefined;
    if (r.locationName && !locationId) errors.push(`Unknown location "${r.locationName}"`);
    const managerId = r.managerEmail ? managerByEmail.get(r.managerEmail.toLowerCase()) : undefined;
    if (r.managerEmail && !managerId) errors.push(`Manager "${r.managerEmail}" not found`);
    const annualCtc = r.annualCtc ? Number(r.annualCtc.replace(/[,\s]/g, "")) : undefined;
    if (r.annualCtc && (annualCtc === undefined || Number.isNaN(annualCtc) || annualCtc < 0)) errors.push("annualCtc must be a number");
    const gender = r.gender ? (r.gender.toUpperCase() as (typeof GENDERS)[number]) : undefined;
    if (gender && !GENDERS.includes(gender)) errors.push(`gender must be one of ${GENDERS.join("/")}`);
    const employmentType = r.employmentType ? (r.employmentType.toUpperCase().replace(/[\s-]/g, "_") as (typeof EMPLOYMENT_TYPES)[number]) : undefined;
    if (employmentType && !EMPLOYMENT_TYPES.includes(employmentType)) errors.push(`employmentType must be one of ${EMPLOYMENT_TYPES.join("/")}`);
    const result: ImportRowResult = { row: i + 2, ok: errors.length === 0, errors, workEmail: email, name: `${r.firstName} ${r.lastName}`.trim() };
    if (!result.ok) return { result };
    return {
      result,
      input: { firstName: r.firstName, lastName: r.lastName, workEmail: email, joiningDate: r.joiningDate, departmentId, designationId, locationId, managerId, annualCtc, phone: r.phone || undefined, gender, employmentType, createUser: true, roleKeys: ["EMPLOYEE"], sendInvite: false },
    };
  });

  let created = 0;
  if (opts.commit) {
    // Sequential so employee-code allocation stays unique; chunked to keep progress observable.
    const CHUNK = 25;
    for (let i = 0; i < prepared.length; i += CHUNK) {
      for (const p of prepared.slice(i, i + CHUNK)) {
        if (!p.input) continue;
        try {
          const r = await createEmployeeInternal(actor, p.input);
          p.result.employeeCode = r.employeeCode;
          p.result.id = r.id;
          created++;
        } catch (e) {
          p.result.ok = false;
          p.result.errors.push(e instanceof Error ? e.message : "Failed to create");
        }
      }
    }
    await audit(actor, "employees.import", "Employee", null, { after: { rows: prepared.length, created } });
  }
  const rows = prepared.map((p) => p.result);
  return { rows, valid: rows.filter((r) => r.ok).length, invalid: rows.filter((r) => !r.ok).length, created, committed: opts.commit };
}

// ── Org chart ──────────────────────────────────────────────────────────

export interface OrgNode {
  id: string;
  displayName: string;
  employeeCode: string;
  designation: string | null;
  department: string | null;
  photoUrl: string | null;
  managerId: string | null;
  reportCount: number;
  depth: number;
}

/** Nodes up to 4 levels below `rootId` (default: employees without a manager). */
export async function orgChart(actor: Actor, rootId?: string | null): Promise<OrgNode[]> {
  const ids = await visibleEmployeeIds(actor, "employees:read");
  if (ids !== null && ids.length === 0) return [];
  const rootCond = rootId ? Prisma.sql`e.id = ${rootId}::uuid` : Prisma.sql`e."managerId" IS NULL`;
  const rows = await db.$queryRaw<OrgNode[]>`
    WITH RECURSIVE tree AS (
      SELECT e.id, 0 AS depth FROM "Employee" e WHERE ${rootCond} AND e.status <> 'EXITED'
      UNION ALL
      SELECT e.id, t.depth + 1 FROM "Employee" e JOIN tree t ON e."managerId" = t.id WHERE t.depth < 4 AND e.status <> 'EXITED'
    )
    SELECT t.id, t.depth, e."displayName", e."employeeCode", e."photoUrl", e."managerId",
           d.name AS designation, dp.name AS department,
           (SELECT count(*) FROM "Employee" r WHERE r."managerId" = t.id AND r.status <> 'EXITED')::int AS "reportCount"
    FROM tree t
    JOIN "Employee" e ON e.id = t.id
    LEFT JOIN "Designation" d ON d.id = e."designationId"
    LEFT JOIN "Department" dp ON dp.id = e."departmentId"
    ORDER BY t.depth, e."displayName"
    LIMIT 3000`;
  if (ids === null) return rows;
  const visible = new Set(ids);
  return rows.filter((r) => visible.has(r.id));
}

/** Lightweight search used by manager pickers: id + name + code. */
export async function searchEmployees(actor: Actor, q: string, limit = 10) {
  await authorize(actor, "employees:read");
  const term = q.trim();
  if (!term) return [];
  return db.employee.findMany({
    where: { status: { not: "EXITED" }, OR: [{ displayName: { contains: term, mode: "insensitive" } }, { employeeCode: { contains: term, mode: "insensitive" } }, { workEmail: { contains: term, mode: "insensitive" } }] },
    orderBy: { displayName: "asc" },
    take: Math.min(limit, 25),
    select: { id: true, displayName: true, employeeCode: true, workEmail: true, designation: { select: { name: true } } },
  });
}
