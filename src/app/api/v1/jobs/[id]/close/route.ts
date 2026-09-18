import { ok, route } from "@/lib/api";
import { closeJob } from "@/server/services/hiring";

export const POST = route<{ id: string }>(async (_req, { actor, params }) => ok(await closeJob(actor, params.id)));
