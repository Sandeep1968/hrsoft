import { ok, route } from "@/lib/api";
import { withdrawClaim } from "@/server/services/expenses";

export const POST = route<{ id: string }>(async (_req, { actor, params }) => ok(await withdrawClaim(actor, params.id)));
