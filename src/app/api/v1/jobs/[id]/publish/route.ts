import { ok, route } from "@/lib/api";
import { publishJob } from "@/server/services/hiring";

export const POST = route<{ id: string }>(async (_req, { actor, params }) => ok(await publishJob(actor, params.id)));
