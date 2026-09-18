import "server-only";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { randomToken } from "@/lib/crypto";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { type Actor, authorize } from "@/lib/rbac/authorize";

/** Events other modules may emit through `dispatchWebhook`. "*" subscribes to everything. */
export const WEBHOOK_EVENTS = [
  "*",
  "employee.created",
  "employee.updated",
  "employee.exited",
  "leave.requested",
  "leave.decided",
  "attendance.regularized",
  "expense.submitted",
  "expense.decided",
  "payroll.finalized",
  "timesheet.submitted",
  "timesheet.decided",
  "ticket.created",
  "ticket.resolved",
  "asset.assigned",
  "asset.returned",
  "project.created",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const webhookSchema = z.object({
  url: z.string().url().max(500).refine((u) => u.startsWith("https://") || u.startsWith("http://localhost") || u.startsWith("http://127.0.0.1"), "Webhook URLs must use https"),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(50),
  isActive: z.boolean().default(true),
});
export type WebhookInput = z.infer<typeof webhookSchema>;

const DISPATCH_TIMEOUT_MS = 5000;

function maskSecret(secret: string) {
  return `${"•".repeat(8)}${secret.slice(-4)}`;
}

function serialize(w: { id: string; url: string; secret: string; events: string[]; isActive: boolean; createdAt: Date }) {
  return { id: w.id, url: w.url, secretMasked: maskSecret(w.secret), events: w.events, isActive: w.isActive, createdAt: w.createdAt.toISOString() };
}

export async function listWebhooks(actor: Actor) {
  await authorize(actor, "settings:manage");
  const rows = await db.webhook.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map(serialize);
}

/** Creates a webhook; the signing secret is returned in plain text exactly once. */
export async function createWebhook(actor: Actor, input: WebhookInput) {
  await authorize(actor, "settings:manage");
  const secret = `whsec_${randomToken(24)}`;
  const w = await db.webhook.create({ data: { url: input.url, events: input.events, isActive: input.isActive, secret } });
  await audit(actor, "webhooks.create", "Webhook", w.id, { after: { url: w.url, events: w.events, isActive: w.isActive } });
  return { ...serialize(w), secret };
}

export async function updateWebhook(actor: Actor, id: string, input: Partial<WebhookInput>) {
  await authorize(actor, "settings:manage");
  const before = await db.webhook.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Webhook");
  const w = await db.webhook.update({ where: { id }, data: { url: input.url, events: input.events, isActive: input.isActive } });
  await audit(actor, "webhooks.update", "Webhook", id, { before: { url: before.url, events: before.events, isActive: before.isActive }, after: { url: w.url, events: w.events, isActive: w.isActive } });
  return serialize(w);
}

export async function deleteWebhook(actor: Actor, id: string) {
  await authorize(actor, "settings:manage");
  const before = await db.webhook.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Webhook");
  await db.webhook.delete({ where: { id } });
  await audit(actor, "webhooks.delete", "Webhook", id, { before: { url: before.url, events: before.events } });
  return { id };
}

/** Rotates the signing secret; the new secret is returned once. */
export async function rotateWebhookSecret(actor: Actor, id: string) {
  await authorize(actor, "settings:manage");
  const secret = `whsec_${randomToken(24)}`;
  const w = await db.webhook.update({ where: { id }, data: { secret } }).catch(() => null);
  if (!w) throw new NotFoundError("Webhook");
  await audit(actor, "webhooks.rotate_secret", "Webhook", id);
  return { ...serialize(w), secret };
}

export function signPayload(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

async function deliver(hook: { id: string; url: string; secret: string }, event: string, payload: unknown): Promise<{ ok: boolean; status: number | null; error?: string; ms: number }> {
  const body = JSON.stringify({ id: randomToken(12), event, createdAt: new Date().toISOString(), data: payload });
  const started = Date.now();
  try {
    const res = await fetch(hook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "HRsoft-Webhooks/1.0",
        "X-HRsoft-Event": event,
        "X-HRsoft-Webhook-Id": hook.id,
        "X-HRsoft-Signature": signPayload(hook.secret, body),
      },
      body,
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
      redirect: "manual",
    });
    return { ok: res.ok, status: res.status, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, status: null, error: e instanceof Error ? e.message : String(e), ms: Date.now() - started };
  }
}

/**
 * Fire-and-forget delivery to every active webhook subscribed to `event` (or "*").
 * Never throws and never blocks the caller for more than the DB lookup; failures are logged.
 */
export function dispatchWebhook(event: WebhookEvent | string, payload: unknown): void {
  void (async () => {
    try {
      const hooks = await db.webhook.findMany({ where: { isActive: true, events: { hasSome: [event, "*"] } }, select: { id: true, url: true, secret: true } });
      await Promise.all(
        hooks.map(async (h) => {
          const r = await deliver(h, event, payload);
          if (!r.ok) console.warn(`[webhook] ${event} → ${h.url} failed (${r.status ?? r.error})`);
        }),
      );
    } catch (e) {
      console.error("dispatchWebhook failed", e);
    }
  })();
}

/** Sends a synthetic `test` event and returns the delivery result. */
export async function testWebhook(actor: Actor, id: string) {
  await authorize(actor, "settings:manage");
  const hook = await db.webhook.findUnique({ where: { id }, select: { id: true, url: true, secret: true } });
  if (!hook) throw new NotFoundError("Webhook");
  const result = await deliver(hook, "test", { message: "HRsoft webhook test", triggeredBy: actor.email });
  await audit(actor, "webhooks.test", "Webhook", id, { after: result });
  if (result.status === null && result.error?.includes("Invalid URL")) throw new ValidationError("Webhook URL is invalid");
  return result;
}
