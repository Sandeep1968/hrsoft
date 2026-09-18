import { ok, parseBody, route } from "@/lib/api";
import { getApplication, rateApplication, rateApplicationSchema } from "@/server/services/hiring";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await getApplication(actor, params.id)));
export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await rateApplication(actor, params.id, await parseBody(req, rateApplicationSchema))));
