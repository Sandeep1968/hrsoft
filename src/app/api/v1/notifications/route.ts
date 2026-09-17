import { z } from "zod";
import { db } from "@/lib/db";
import { ok, parseBody, route } from "@/lib/api";

export const GET = route(async (_req, { actor, query }) => {
  const unreadOnly = query.get("unread") === "1";
  const items = await db.notification.findMany({
    where: { userId: actor.userId, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return ok(items);
});

/** Mark notifications read: { ids: [...] } or { all: true } */
export const PATCH = route(async (req, { actor }) => {
  const body = await parseBody(req, z.object({ ids: z.array(z.string().uuid()).optional(), all: z.boolean().optional() }));
  const r = await db.notification.updateMany({
    where: { userId: actor.userId, readAt: null, ...(body.all ? {} : { id: { in: body.ids ?? [] } }) },
    data: { readAt: new Date() },
  });
  return ok({ updated: r.count });
});
