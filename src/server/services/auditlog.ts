import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { paginate, paginationSchema, toPage, zUuid } from "@/lib/api";
import { type Actor, authorize } from "@/lib/rbac/authorize";

export const listAuditSchema = paginationSchema.extend({
  actorId: zUuid.optional(),
  entityType: z.string().trim().max(60).optional(),
  entityId: z.string().trim().max(120).optional(),
  action: z.string().trim().max(80).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export async function listAuditLogs(actor: Actor, p: z.infer<typeof listAuditSchema>) {
  await authorize(actor, "audit:read");
  const where: Prisma.AuditLogWhereInput = {
    AND: [
      p.actorId ? { actorId: p.actorId } : {},
      p.entityType ? { entityType: { equals: p.entityType, mode: "insensitive" } } : {},
      p.entityId ? { entityId: p.entityId } : {},
      p.action ? (p.action.endsWith("*") ? { action: { startsWith: p.action.slice(0, -1) } } : { action: p.action }) : {},
      p.from ? { createdAt: { gte: p.from } } : {},
      p.to ? { createdAt: { lte: p.to } } : {},
      p.q ? { OR: [{ action: { contains: p.q, mode: "insensitive" } }, { entityType: { contains: p.q, mode: "insensitive" } }, { entityId: { contains: p.q } }, { actor: { email: { contains: p.q, mode: "insensitive" } } }] } : {},
    ],
  };
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: p.order === "asc" ? "asc" : "desc" }, ...paginate(p), include: { actor: { select: { id: true, name: true, email: true } } } }),
    db.auditLog.count({ where }),
  ]);
  return toPage(
    rows.map((r) => ({ id: r.id, action: r.action, entityType: r.entityType, entityId: r.entityId, actor: r.actor ? { id: r.actor.id, name: r.actor.name, email: r.actor.email } : null, before: r.before, after: r.after, ip: r.ip, createdAt: r.createdAt.toISOString() })),
    total,
    p,
  );
}
export type AuditLogDto = Awaited<ReturnType<typeof listAuditLogs>>["items"][number];

/** Distinct action names and entity types (cached shape for filter dropdowns). */
export async function auditActions(actor: Actor) {
  await authorize(actor, "audit:read");
  const [actions, entities] = await Promise.all([
    db.$queryRaw<{ action: string }[]>`SELECT DISTINCT action FROM "AuditLog" ORDER BY action LIMIT 500`,
    db.$queryRaw<{ entityType: string }[]>`SELECT DISTINCT "entityType" FROM "AuditLog" ORDER BY "entityType" LIMIT 200`,
  ]);
  return { actions: actions.map((a) => a.action), entityTypes: entities.map((e) => e.entityType) };
}
