import "server-only";
import { z } from "zod";
import { Prisma, type AssetStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { addDays, isoDate, todayUtc } from "@/lib/dates";
import { paginate, paginationSchema, toPage, zDateOnly, zUuid } from "@/lib/api";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { type Actor, authorize, can, requireEmployee, visibleEmployeeIds } from "@/lib/rbac/authorize";
import { dispatchWebhook } from "@/server/services/webhooks";

// ── Schemas ────────────────────────────────────────────────────────────

const STATUSES = ["AVAILABLE", "ASSIGNED", "IN_REPAIR", "RETIRED", "LOST"] as const;

export const assetCategorySchema = z.object({ name: z.string().trim().min(1).max(80) });

export const assetSchema = z.object({
  categoryId: zUuid,
  name: z.string().trim().min(1).max(160),
  assetTag: z.string().trim().min(2).max(40).transform((s) => s.toUpperCase()),
  serialNumber: z.string().trim().max(120).optional().nullable(),
  purchaseDate: zDateOnly.optional().nullable(),
  purchaseCost: z.coerce.number().min(0).max(100_000_000).optional().nullable(),
  vendor: z.string().trim().max(120).optional().nullable(),
  warrantyUntil: zDateOnly.optional().nullable(),
  locationId: zUuid.optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});
export type AssetInput = z.infer<typeof assetSchema>;
export const assetUpdateSchema = assetSchema.partial().extend({ status: z.enum(["AVAILABLE", "IN_REPAIR", "RETIRED", "LOST"]).optional() });

export const assignSchema = z.object({ employeeId: zUuid, condition: z.string().trim().max(200).optional().nullable(), notes: z.string().trim().max(1000).optional().nullable() });
export const returnSchema = z.object({ condition: z.string().trim().max(200).optional().nullable(), notes: z.string().trim().max(1000).optional().nullable(), status: z.enum(["AVAILABLE", "IN_REPAIR", "RETIRED", "LOST"]).default("AVAILABLE") });

export const listAssetsSchema = paginationSchema.extend({
  status: z.enum(STATUSES).optional(),
  categoryId: zUuid.optional(),
  locationId: zUuid.optional(),
  employeeId: zUuid.optional(),
  warrantyExpiring: z.coerce.boolean().optional(),
});

// ── Serialisation ──────────────────────────────────────────────────────

const assetInclude = {
  category: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  assignments: { where: { returnedAt: null }, take: 1, include: { employee: { select: { id: true, displayName: true, employeeCode: true } } } },
} satisfies Prisma.AssetInclude;
type AssetRow = Prisma.AssetGetPayload<{ include: typeof assetInclude }>;

function serializeAsset(a: AssetRow) {
  const current = a.assignments[0] ?? null;
  const warrantyDays = a.warrantyUntil ? Math.round((a.warrantyUntil.getTime() - todayUtc().getTime()) / 86_400_000) : null;
  return {
    id: a.id,
    name: a.name,
    assetTag: a.assetTag,
    serialNumber: a.serialNumber,
    category: a.category,
    location: a.location,
    status: a.status,
    purchaseDate: a.purchaseDate ? isoDate(a.purchaseDate) : null,
    purchaseCost: a.purchaseCost === null ? null : Number(a.purchaseCost),
    vendor: a.vendor,
    warrantyUntil: a.warrantyUntil ? isoDate(a.warrantyUntil) : null,
    warrantyDaysLeft: warrantyDays,
    warrantyState: warrantyDays === null ? null : warrantyDays < 0 ? "EXPIRED" : warrantyDays <= 90 ? "EXPIRING" : "OK",
    notes: a.notes,
    assignedTo: current ? { assignmentId: current.id, employeeId: current.employee.id, displayName: current.employee.displayName, employeeCode: current.employee.employeeCode, assignedAt: current.assignedAt.toISOString(), condition: current.condition } : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}
export type AssetDto = ReturnType<typeof serializeAsset>;

// ── Categories ─────────────────────────────────────────────────────────

export async function listAssetCategories(actor: Actor) {
  await authorize(actor, "assets:read");
  const rows = await db.assetCategory.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { assets: true } } } });
  return rows.map((c) => ({ id: c.id, name: c.name, assetCount: c._count.assets }));
}

export async function createAssetCategory(actor: Actor, input: z.infer<typeof assetCategorySchema>) {
  await authorize(actor, "assets:manage");
  const c = await db.assetCategory.create({ data: input });
  await audit(actor, "assets.category_create", "AssetCategory", c.id, { after: input });
  return c;
}

export async function updateAssetCategory(actor: Actor, id: string, input: z.infer<typeof assetCategorySchema>) {
  await authorize(actor, "assets:manage");
  const before = await db.assetCategory.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Asset category");
  const c = await db.assetCategory.update({ where: { id }, data: input });
  await audit(actor, "assets.category_update", "AssetCategory", id, { before, after: c });
  return c;
}

export async function deleteAssetCategory(actor: Actor, id: string) {
  await authorize(actor, "assets:manage");
  const before = await db.assetCategory.findUnique({ where: { id }, include: { _count: { select: { assets: true } } } });
  if (!before) throw new NotFoundError("Asset category");
  if (before._count.assets > 0) throw new ConflictError("Category still has assets");
  await db.assetCategory.delete({ where: { id } });
  await audit(actor, "assets.category_delete", "AssetCategory", id, { before: { name: before.name } });
  return { id };
}

// ── Assets ─────────────────────────────────────────────────────────────

export async function listAssets(actor: Actor, p: z.infer<typeof listAssetsSchema>) {
  const ids = await visibleEmployeeIds(actor, "assets:read");
  const where: Prisma.AssetWhereInput = {
    AND: [
      ids === null ? {} : { assignments: { some: { returnedAt: null, employeeId: { in: ids } } } },
      p.status ? { status: p.status } : {},
      p.categoryId ? { categoryId: p.categoryId } : {},
      p.locationId ? { locationId: p.locationId } : {},
      p.employeeId ? { assignments: { some: { returnedAt: null, employeeId: p.employeeId } } } : {},
      p.warrantyExpiring ? { warrantyUntil: { lte: addDays(todayUtc(), 90) }, status: { notIn: ["RETIRED", "LOST"] } } : {},
      p.q ? { OR: [{ name: { contains: p.q, mode: "insensitive" } }, { assetTag: { contains: p.q, mode: "insensitive" } }, { serialNumber: { contains: p.q, mode: "insensitive" } }] } : {},
    ],
  };
  const orderBy: Prisma.AssetOrderByWithRelationInput = p.sort === "name" ? { name: p.order } : p.sort === "status" ? { status: p.order } : p.sort === "warrantyUntil" ? { warrantyUntil: p.order } : { assetTag: p.order };
  const [rows, total] = await Promise.all([db.asset.findMany({ where, orderBy, ...paginate(p), include: assetInclude }), db.asset.count({ where })]);
  return toPage(rows.map(serializeAsset), total, p);
}

export async function getAsset(actor: Actor, id: string) {
  const ids = await visibleEmployeeIds(actor, "assets:read");
  const a = await db.asset.findUnique({ where: { id }, include: assetInclude });
  if (!a) throw new NotFoundError("Asset");
  if (ids !== null && !(await db.assetAssignment.count({ where: { assetId: id, employeeId: { in: ids } } }))) throw new ForbiddenError();
  return { ...serializeAsset(a), history: await assetHistory(actor, id) };
}

export async function createAsset(actor: Actor, input: AssetInput) {
  await authorize(actor, "assets:manage");
  if (await db.asset.findUnique({ where: { assetTag: input.assetTag }, select: { id: true } })) throw new ConflictError(`Asset tag ${input.assetTag} already exists`);
  const a = await db.asset.create({ data: { ...input, status: "AVAILABLE" }, include: assetInclude });
  await audit(actor, "assets.create", "Asset", a.id, { after: input });
  return serializeAsset(a);
}

export async function updateAsset(actor: Actor, id: string, input: z.infer<typeof assetUpdateSchema>) {
  await authorize(actor, "assets:manage");
  const before = await db.asset.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Asset");
  if (input.assetTag && input.assetTag !== before.assetTag && (await db.asset.findUnique({ where: { assetTag: input.assetTag }, select: { id: true } }))) throw new ConflictError(`Asset tag ${input.assetTag} already exists`);
  if (input.status && before.status === "ASSIGNED") throw new ConflictError("Return the asset before changing its status");
  const a = await db.asset.update({ where: { id }, data: input, include: assetInclude });
  await audit(actor, "assets.update", "Asset", id, { before, after: a });
  return serializeAsset(a);
}

export async function deleteAsset(actor: Actor, id: string) {
  await authorize(actor, "assets:manage");
  const before = await db.asset.findUnique({ where: { id }, include: { _count: { select: { assignments: true } } } });
  if (!before) throw new NotFoundError("Asset");
  if (before.status === "ASSIGNED") throw new ConflictError("Return the asset before deleting it");
  if (before._count.assignments > 0) throw new ConflictError("Asset has assignment history; retire it instead");
  await db.asset.delete({ where: { id } });
  await audit(actor, "assets.delete", "Asset", id, { before: { assetTag: before.assetTag, name: before.name } });
  return { id };
}

// ── Assignment ─────────────────────────────────────────────────────────

export async function assignAsset(actor: Actor, assetId: string, input: z.infer<typeof assignSchema>) {
  await authorize(actor, "assets:manage");
  const asset = await db.asset.findUnique({ where: { id: assetId }, select: { id: true, status: true, name: true, assetTag: true } });
  if (!asset) throw new NotFoundError("Asset");
  if (asset.status !== "AVAILABLE") throw new ConflictError(`Asset is ${asset.status.toLowerCase().replace("_", " ")}; only available assets can be assigned`);
  const emp = await db.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, status: true, displayName: true } });
  if (!emp) throw new NotFoundError("Employee");
  if (emp.status === "EXITED") throw new ValidationError("Cannot assign assets to an exited employee");
  const [assignment] = await db.$transaction([
    db.assetAssignment.create({ data: { assetId, employeeId: input.employeeId, assignedById: actor.employeeId, condition: input.condition ?? null, notes: input.notes ?? null } }),
    db.asset.update({ where: { id: assetId }, data: { status: "ASSIGNED" } }),
  ]);
  await audit(actor, "assets.assign", "Asset", assetId, { after: { employeeId: input.employeeId, condition: input.condition ?? null } });
  await notify({ employeeId: input.employeeId, type: "asset.assigned", title: `Asset assigned to you: ${asset.name}`, body: `${asset.assetTag}${input.condition ? ` · condition: ${input.condition}` : ""}`, link: "/assets" });
  dispatchWebhook("asset.assigned", { assetId, assetTag: asset.assetTag, employeeId: input.employeeId });
  const full = await db.asset.findUnique({ where: { id: assetId }, include: assetInclude });
  return { ...serializeAsset(full!), assignmentId: assignment.id };
}

export async function returnAsset(actor: Actor, assetId: string, input: z.infer<typeof returnSchema>) {
  await authorize(actor, "assets:manage");
  const open = await db.assetAssignment.findFirst({ where: { assetId, returnedAt: null }, orderBy: { assignedAt: "desc" }, include: { asset: { select: { name: true, assetTag: true } } } });
  if (!open) throw new ConflictError("Asset is not currently assigned");
  await db.$transaction([
    db.assetAssignment.update({ where: { id: open.id }, data: { returnedAt: new Date(), condition: input.condition ?? open.condition, notes: input.notes ? (open.notes ? `${open.notes}\n---\n${input.notes}` : input.notes) : open.notes } }),
    db.asset.update({ where: { id: assetId }, data: { status: input.status } }),
  ]);
  await audit(actor, "assets.return", "Asset", assetId, { before: { employeeId: open.employeeId }, after: { status: input.status, condition: input.condition ?? null } });
  await notify({ employeeId: open.employeeId, type: "asset.returned", title: `Asset return recorded: ${open.asset.name}`, body: open.asset.assetTag, link: "/assets" });
  dispatchWebhook("asset.returned", { assetId, assetTag: open.asset.assetTag, employeeId: open.employeeId, status: input.status });
  const full = await db.asset.findUnique({ where: { id: assetId }, include: assetInclude });
  return serializeAsset(full!);
}

export async function myAssets(actor: Actor) {
  const employeeId = requireEmployee(actor);
  await authorize(actor, "assets:read", { employeeId });
  const rows = await db.assetAssignment.findMany({ where: { employeeId, returnedAt: null }, orderBy: { assignedAt: "desc" }, include: { asset: { include: assetInclude } } });
  return rows.map((r) => ({ ...serializeAsset(r.asset), assignedAt: r.assignedAt.toISOString(), condition: r.condition, notes: r.notes }));
}

export async function assetHistory(actor: Actor, assetId: string) {
  await authorize(actor, "assets:read");
  const rows = await db.assetAssignment.findMany({
    where: { assetId },
    orderBy: { assignedAt: "desc" },
    take: 100,
    include: { employee: { select: { id: true, displayName: true, employeeCode: true } }, assignedBy: { select: { displayName: true } } },
  });
  return rows.map((r) => ({ id: r.id, employee: r.employee, assignedBy: r.assignedBy?.displayName ?? null, assignedAt: r.assignedAt.toISOString(), returnedAt: r.returnedAt?.toISOString() ?? null, condition: r.condition, notes: r.notes }));
}

export async function assetsSummary(actor: Actor) {
  await authorize(actor, "assets:read", { minScope: "ALL" });
  const soon = addDays(todayUtc(), 90);
  const [byStatus, byCategory, categories, expiring, expiringCount, value] = await Promise.all([
    db.asset.groupBy({ by: ["status"], _count: { _all: true } }),
    db.asset.groupBy({ by: ["categoryId", "status"], _count: { _all: true } }),
    db.assetCategory.findMany({ select: { id: true, name: true } }),
    db.asset.findMany({ where: { warrantyUntil: { lte: soon }, status: { notIn: ["RETIRED", "LOST"] } }, orderBy: { warrantyUntil: "asc" }, take: 20, include: assetInclude }),
    db.asset.count({ where: { warrantyUntil: { lte: soon, gte: todayUtc() }, status: { notIn: ["RETIRED", "LOST"] } } }),
    db.asset.aggregate({ _sum: { purchaseCost: true }, where: { status: { notIn: ["RETIRED", "LOST"] } } }),
  ]);
  const statusCounts: Record<AssetStatus, number> = { AVAILABLE: 0, ASSIGNED: 0, IN_REPAIR: 0, RETIRED: 0, LOST: 0 };
  for (const s of byStatus) statusCounts[s.status] = s._count._all;
  const catRows = categories.map((c) => {
    const row: Record<string, string | number> = { categoryId: c.id, category: c.name, total: 0 };
    for (const s of STATUSES) row[s] = 0;
    for (const b of byCategory.filter((x) => x.categoryId === c.id)) {
      row[b.status] = b._count._all;
      row.total = (row.total as number) + b._count._all;
    }
    return row;
  });
  return {
    total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
    byStatus: statusCounts,
    byCategory: catRows.sort((a, b) => (b.total as number) - (a.total as number)),
    warrantyExpiringCount: expiringCount,
    warrantyExpiring: expiring.map(serializeAsset),
    bookValue: Number(value._sum.purchaseCost ?? 0),
  };
}

/** Lookup lists for the admin UI. */
export async function assetLookups(actor: Actor) {
  await authorize(actor, "assets:read");
  const [categories, locations] = await Promise.all([db.assetCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }), db.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } })]);
  return { categories, locations };
}

export const canManageAssets = (actor: Actor) => can(actor, "assets:manage");
