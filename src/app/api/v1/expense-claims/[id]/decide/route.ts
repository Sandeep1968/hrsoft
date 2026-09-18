import { ok, parseBody, route } from "@/lib/api";
import { decideClaim, decideSchema } from "@/server/services/expenses";

/** Shared approval contract: { decision: "APPROVED" | "REJECTED", note? } */
export const POST = route<{ id: string }>(async (req, { actor, params }) => ok(await decideClaim(actor, params.id, await parseBody(req, decideSchema))));
