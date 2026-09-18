import { ok, parseBody, route } from "@/lib/api";
import { deleteClaim, getClaim, updateClaim, updateClaimSchema } from "@/server/services/expenses";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await getClaim(actor, params.id)));
export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateClaim(actor, params.id, await parseBody(req, updateClaimSchema))));
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => ok(await deleteClaim(actor, params.id)));
