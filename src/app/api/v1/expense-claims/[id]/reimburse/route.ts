import { ok, parseBody, route } from "@/lib/api";
import { reimburseClaim, reimburseSchema } from "@/server/services/expenses";

export const POST = route<{ id: string }>(async (req, { actor, params }) => ok(await reimburseClaim(actor, params.id, await parseBody(req, reimburseSchema))));
