import { ok, route } from "@/lib/api";
import { completeCycle } from "@/server/services/performance";

export const POST = route<{ id: string }>(async (_req, { actor, params }) => ok(await completeCycle(actor, params.id)));
