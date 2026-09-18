import { ok, route } from "@/lib/api";
import { submitClaim } from "@/server/services/expenses";

export const POST = route<{ id: string }>(async (_req, { actor, params }) => ok(await submitClaim(actor, params.id)));
