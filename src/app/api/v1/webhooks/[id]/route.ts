import { ok, parseBody, route } from "@/lib/api";
import { deleteWebhook, rotateWebhookSecret, updateWebhook, webhookSchema } from "@/server/services/webhooks";

export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateWebhook(actor, params.id, await parseBody(req, webhookSchema.partial()))));
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => ok(await deleteWebhook(actor, params.id)));
/** POST /webhooks/:id — rotates the signing secret. */
export const POST = route<{ id: string }>(async (_req, { actor, params }) => ok(await rotateWebhookSecret(actor, params.id)));
