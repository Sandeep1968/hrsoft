import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { zUuid } from "@/lib/api";
import { type Actor, authorize } from "@/lib/rbac/authorize";

const optionalUuid = z.preprocess((v) => (v === "" ? null : v), zUuid.nullable().optional());
const optionalStr = (max: number) => z.preprocess((v) => (v === "" ? null : v), z.string().trim().max(max).nullable().optional());
const pct = z.coerce.number().min(0).max(100);

// ── Organization (single row) ──────────────────────────────────────────

export const organizationSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    legalName: optionalStr(200),
    domain: optionalStr(120),
    logoUrl: optionalStr(500),
    timezone: z.string().trim().min(1).max(60),
    currency: z.string().trim().length(3).toUpperCase(),
    financialYearStartMonth: z.coerce.number().int().min(1).max(12),
    weekStartsOn: z.coerce.number().int().min(0).max(6),
    settings: z.record(z.string(), z.unknown()),
  })
  .partial();

export async function getOrganization(actor: Actor) {
  await authorize(actor, "org:read");
  const org = await db.organization.findFirst();
  if (!org) throw new NotFoundError("Organization");
  return { ...org, settings: (org.settings as Record<string, unknown>) ?? {}, createdAt: org.createdAt.toISOString(), updatedAt: org.updatedAt.toISOString() };
}

export async function updateOrganization(actor: Actor, patch: z.infer<typeof organizationSchema>) {
  await authorize(actor, "org:manage");
  const before = await db.organization.findFirst();
  if (!before) throw new NotFoundError("Organization");
  const org = await db.organization.update({ where: { id: before.id }, data: { ...patch, settings: patch.settings === undefined ? undefined : (patch.settings as Prisma.InputJsonValue) } });
  await audit(actor, "org.update", "Organization", org.id, { before, after: patch });
  return getOrganization(actor);
}

// ── Legal entities ─────────────────────────────────────────────────────

export const legalEntitySchema = z.object({
  name: z.string().trim().min(1).max(160),
  pan: optionalStr(10),
  tan: optionalStr(10),
  gstin: optionalStr(15),
  cin: optionalStr(21),
  pfCode: optionalStr(40),
  esiCode: optionalStr(40),
  ptState: optionalStr(2),
  address: z.record(z.string(), z.unknown()).nullable().optional(),
  isDefault: z.boolean().optional(),
  pfEmployeePct: pct.optional(),
  pfEmployerPct: pct.optional(),
  pfWageCeiling: z.coerce.number().min(0).optional(),
  esiEmployeePct: pct.optional(),
  esiEmployerPct: pct.optional(),
  esiWageCeiling: z.coerce.number().min(0).optional(),
});
export type LegalEntityInput = z.infer<typeof legalEntitySchema>;

type StatKey = "pfEmployeePct" | "pfEmployerPct" | "pfWageCeiling" | "esiEmployeePct" | "esiEmployerPct" | "esiWageCeiling";
type EntityRow = Prisma.LegalEntityGetPayload<object>;
export type LegalEntityDto = Omit<EntityRow, StatKey | "address" | "createdAt" | "updatedAt"> & Record<StatKey, number> & { address: Record<string, unknown> | null; createdAt: string; updatedAt: string };

function serializeEntity(e: EntityRow): LegalEntityDto {
  const { pfEmployeePct, pfEmployerPct, pfWageCeiling, esiEmployeePct, esiEmployerPct, esiWageCeiling, address, createdAt, updatedAt, ...rest } = e;
  return {
    ...rest,
    address: (address as Record<string, unknown> | null) ?? null,
    pfEmployeePct: Number(pfEmployeePct),
    pfEmployerPct: Number(pfEmployerPct),
    pfWageCeiling: Number(pfWageCeiling),
    esiEmployeePct: Number(esiEmployeePct),
    esiEmployerPct: Number(esiEmployerPct),
    esiWageCeiling: Number(esiWageCeiling),
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

export async function listLegalEntities(actor: Actor) {
  await authorize(actor, "org:read");
  return (await db.legalEntity.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] })).map(serializeEntity);
}

export async function createLegalEntity(actor: Actor, input: LegalEntityInput) {
  await authorize(actor, "org:manage");
  const row = await db.$transaction(async (tx) => {
    const count = await tx.legalEntity.count();
    const isDefault = input.isDefault || count === 0;
    if (isDefault) await tx.legalEntity.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    return tx.legalEntity.create({ data: { ...input, isDefault, address: input.address === null ? Prisma.DbNull : (input.address as Prisma.InputJsonValue | undefined) } });
  });
  await audit(actor, "org.legal_entity_create", "LegalEntity", row.id, { after: input });
  return serializeEntity(row);
}

export async function updateLegalEntity(actor: Actor, id: string, input: Partial<LegalEntityInput>) {
  await authorize(actor, "org:manage");
  const before = await db.legalEntity.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Legal entity");
  const row = await db.$transaction(async (tx) => {
    if (input.isDefault) await tx.legalEntity.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
    if (input.isDefault === false && before.isDefault) throw new ValidationError("Mark another entity as default first");
    return tx.legalEntity.update({ where: { id }, data: { ...input, address: input.address === undefined ? undefined : input.address === null ? Prisma.DbNull : (input.address as Prisma.InputJsonValue) } });
  });
  await audit(actor, "org.legal_entity_update", "LegalEntity", id, { before, after: input });
  return serializeEntity(row);
}

// ── Locations ──────────────────────────────────────────────────────────

export const locationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: optionalStr(300),
  city: optionalStr(100),
  state: optionalStr(100),
  country: z.string().trim().length(2).toUpperCase().default("IN"),
  timezone: z.string().trim().min(1).max(60).default("Asia/Kolkata"),
  latitude: z.preprocess((v) => (v === "" ? null : v), z.coerce.number().min(-90).max(90).nullable().optional()),
  longitude: z.preprocess((v) => (v === "" ? null : v), z.coerce.number().min(-180).max(180).nullable().optional()),
  geoRadiusM: z.preprocess((v) => (v === "" ? null : v), z.coerce.number().int().min(10).max(50_000).nullable().optional()),
  isActive: z.boolean().optional(),
});
export type LocationInput = z.infer<typeof locationSchema>;

export async function listLocations(actor: Actor, includeInactive = false) {
  await authorize(actor, "org:read");
  const rows = await db.location.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { name: "asc" }, include: { _count: { select: { employees: { where: { status: { not: "EXITED" } } } } } } });
  return rows.map((l) => ({ ...l, employeeCount: l._count.employees, _count: undefined, createdAt: l.createdAt.toISOString(), updatedAt: l.updatedAt.toISOString() }));
}

export async function createLocation(actor: Actor, input: LocationInput) {
  await authorize(actor, "org:manage");
  const row = await db.location.create({ data: input });
  await audit(actor, "org.location_create", "Location", row.id, { after: input });
  return row;
}

export async function updateLocation(actor: Actor, id: string, input: Partial<LocationInput>) {
  await authorize(actor, "org:manage");
  const before = await db.location.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Location");
  const row = await db.location.update({ where: { id }, data: input });
  await audit(actor, "org.location_update", "Location", id, { before, after: input });
  return row;
}

export async function deleteLocation(actor: Actor, id: string) {
  await authorize(actor, "org:manage");
  const inUse = await db.employee.count({ where: { locationId: id, status: { not: "EXITED" } } });
  if (inUse > 0) throw new ConflictError(`${inUse} employees are assigned to this location; deactivate it instead`);
  await db.location.update({ where: { id }, data: { isActive: false } });
  await audit(actor, "org.location_deactivate", "Location", id);
  return { id };
}

// ── Departments ────────────────────────────────────────────────────────

export const departmentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(20).toUpperCase().regex(/^[A-Z0-9_-]+$/, "Code may contain letters, numbers, - and _"),
  parentId: optionalUuid,
  headId: optionalUuid,
  isActive: z.boolean().optional(),
});
export type DepartmentInput = z.infer<typeof departmentSchema>;

export interface DepartmentDto {
  id: string;
  name: string;
  code: string;
  parentId: string | null;
  headId: string | null;
  head: { id: string; displayName: string; employeeCode: string } | null;
  isActive: boolean;
  employeeCount: number;
  children: DepartmentDto[];
}

/** Department tree with head and headcount. */
export async function listDepartments(actor: Actor, includeInactive = false): Promise<DepartmentDto[]> {
  await authorize(actor, "org:read");
  const rows = await db.department.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { name: "asc" },
    include: { head: { select: { id: true, displayName: true, employeeCode: true } }, _count: { select: { employees: { where: { status: { not: "EXITED" } } } } } },
  });
  const nodes = new Map<string, DepartmentDto>(rows.map((r) => [r.id, { id: r.id, name: r.name, code: r.code, parentId: r.parentId, headId: r.headId, head: r.head, isActive: r.isActive, employeeCount: r._count.employees, children: [] }]));
  const roots: DepartmentDto[] = [];
  for (const n of nodes.values()) {
    const parent = n.parentId ? nodes.get(n.parentId) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  return roots;
}

export function flattenDepartments(tree: DepartmentDto[], depth = 0): (DepartmentDto & { depth: number })[] {
  return tree.flatMap((d) => [{ ...d, depth }, ...flattenDepartments(d.children, depth + 1)]);
}

export async function createDepartment(actor: Actor, input: DepartmentInput) {
  await authorize(actor, "org:manage");
  if (await db.department.findUnique({ where: { code: input.code } })) throw new ConflictError(`Department code ${input.code} already exists`);
  const row = await db.department.create({ data: input });
  await audit(actor, "org.department_create", "Department", row.id, { after: input });
  return row;
}

export async function updateDepartment(actor: Actor, id: string, input: Partial<DepartmentInput>) {
  await authorize(actor, "org:manage");
  const before = await db.department.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Department");
  if (input.parentId) {
    if (input.parentId === id) throw new ValidationError("A department cannot be its own parent");
    // Prevent cycles: walk up from the proposed parent.
    let cur: string | null = input.parentId;
    for (let i = 0; cur && i < 20; i++) {
      if (cur === id) throw new ValidationError("This would create a cycle in the department tree");
      const p: { parentId: string | null } | null = await db.department.findUnique({ where: { id: cur }, select: { parentId: true } });
      cur = p?.parentId ?? null;
    }
  }
  const row = await db.department.update({ where: { id }, data: input });
  await audit(actor, "org.department_update", "Department", id, { before, after: input });
  return row;
}

export async function deleteDepartment(actor: Actor, id: string) {
  await authorize(actor, "org:manage");
  const inUse = await db.employee.count({ where: { departmentId: id, status: { not: "EXITED" } } });
  if (inUse > 0) throw new ConflictError(`${inUse} employees are in this department; move them first`);
  await db.department.update({ where: { id }, data: { isActive: false } });
  await audit(actor, "org.department_deactivate", "Department", id);
  return { id };
}

// ── Designations ───────────────────────────────────────────────────────

export const designationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  level: z.coerce.number().int().min(1).max(20).default(1),
  isActive: z.boolean().optional(),
});
export type DesignationInput = z.infer<typeof designationSchema>;

export async function listDesignations(actor: Actor, includeInactive = false) {
  await authorize(actor, "org:read");
  const rows = await db.designation.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: [{ level: "asc" }, { name: "asc" }], include: { _count: { select: { employees: { where: { status: { not: "EXITED" } } } } } } });
  return rows.map((d) => ({ id: d.id, name: d.name, level: d.level, isActive: d.isActive, employeeCount: d._count.employees }));
}

export async function createDesignation(actor: Actor, input: DesignationInput) {
  await authorize(actor, "org:manage");
  if (await db.designation.findUnique({ where: { name: input.name } })) throw new ConflictError(`Designation ${input.name} already exists`);
  const row = await db.designation.create({ data: input });
  await audit(actor, "org.designation_create", "Designation", row.id, { after: input });
  return row;
}

export async function updateDesignation(actor: Actor, id: string, input: Partial<DesignationInput>) {
  await authorize(actor, "org:manage");
  const before = await db.designation.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Designation");
  const row = await db.designation.update({ where: { id }, data: input });
  await audit(actor, "org.designation_update", "Designation", id, { before, after: input });
  return row;
}

export async function deleteDesignation(actor: Actor, id: string) {
  await authorize(actor, "org:manage");
  const inUse = await db.employee.count({ where: { designationId: id, status: { not: "EXITED" } } });
  if (inUse > 0) throw new ConflictError(`${inUse} employees hold this designation; deactivate it instead`);
  await db.designation.update({ where: { id }, data: { isActive: false } });
  await audit(actor, "org.designation_deactivate", "Designation", id);
  return { id };
}

// ── Custom fields ──────────────────────────────────────────────────────

export const CUSTOM_FIELD_TYPES = ["TEXT", "NUMBER", "DATE", "SELECT", "BOOLEAN"] as const;
export const customFieldSchema = z.object({
  entity: z.string().trim().min(1).max(40).default("EMPLOYEE"),
  key: z.string().trim().min(1).max(40).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Key must be an identifier (letters, numbers, _)"),
  label: z.string().trim().min(1).max(120),
  type: z.enum(CUSTOM_FIELD_TYPES).default("TEXT"),
  options: z.array(z.string().trim().min(1).max(80)).default([]),
  required: z.boolean().default(false),
  order: z.coerce.number().int().min(0).default(0),
});
export type CustomFieldInput = z.infer<typeof customFieldSchema>;

export async function listCustomFields(actor: Actor, entity = "EMPLOYEE") {
  await authorize(actor, "org:read");
  return db.customFieldDefinition.findMany({ where: { entity }, orderBy: [{ order: "asc" }, { label: "asc" }] });
}

export async function createCustomField(actor: Actor, input: CustomFieldInput) {
  await authorize(actor, "org:manage");
  if (await db.customFieldDefinition.findUnique({ where: { entity_key: { entity: input.entity, key: input.key } } })) throw new ConflictError(`Field ${input.key} already exists`);
  const row = await db.customFieldDefinition.create({ data: input });
  await audit(actor, "org.custom_field_create", "CustomFieldDefinition", row.id, { after: input });
  return row;
}

export async function updateCustomField(actor: Actor, id: string, input: Partial<CustomFieldInput>) {
  await authorize(actor, "org:manage");
  const before = await db.customFieldDefinition.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Custom field");
  const row = await db.customFieldDefinition.update({ where: { id }, data: input });
  await audit(actor, "org.custom_field_update", "CustomFieldDefinition", id, { before, after: input });
  return row;
}

export async function deleteCustomField(actor: Actor, id: string) {
  await authorize(actor, "org:manage");
  const before = await db.customFieldDefinition.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Custom field");
  await db.customFieldDefinition.delete({ where: { id } });
  await audit(actor, "org.custom_field_delete", "CustomFieldDefinition", id, { before });
  return { id };
}

// ── Lookups for forms ──────────────────────────────────────────────────

export interface OrgLookups {
  departments: { id: string; name: string; code: string }[];
  designations: { id: string; name: string; level: number }[];
  locations: { id: string; name: string }[];
  legalEntities: { id: string; name: string; isDefault: boolean }[];
  shifts: { id: string; name: string; isDefault: boolean }[];
  customFields: { id: string; key: string; label: string; type: string; options: string[]; required: boolean }[];
}

export async function getOrgLookups(actor: Actor): Promise<OrgLookups> {
  await authorize(actor, "org:read");
  const [departments, designations, locations, legalEntities, shifts, customFields] = await Promise.all([
    db.department.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true } }),
    db.designation.findMany({ where: { isActive: true }, orderBy: [{ level: "asc" }, { name: "asc" }], select: { id: true, name: true, level: true } }),
    db.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.legalEntity.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, isDefault: true } }),
    db.shift.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, isDefault: true } }),
    db.customFieldDefinition.findMany({ where: { entity: "EMPLOYEE" }, orderBy: { order: "asc" }, select: { id: true, key: true, label: true, type: true, options: true, required: true } }),
  ]);
  return { departments, designations, locations, legalEntities, shifts, customFields };
}
