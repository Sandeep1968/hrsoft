import { ok, route } from "@/lib/api";
import { testWebhook } from "@/server/services/webhooks";

export const POST = route<{ id: string }>(async (_req, { actor, params }) => ok(await testWebhook(actor, params.id)));
