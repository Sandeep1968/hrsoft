import { ok, route } from "@/lib/api";
import { launchCycle } from "@/server/services/performance";

export const POST = route<{ id: string }>(async (_req, { actor, params }) => ok(await launchCycle(actor, params.id)));
