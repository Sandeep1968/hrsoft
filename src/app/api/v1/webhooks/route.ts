import { created, ok, parseBody, route } from "@/lib/api";
import { createWebhook, listWebhooks, webhookSchema } from "@/server/services/webhooks";

export const GET = route(async (_req, { actor }) => ok(await listWebhooks(actor)));
export const POST = route(async (req, { actor }) => created(await createWebhook(actor, await parseBody(req, webhookSchema))));
