import { ok, parseBody, route } from "@/lib/api";
import { markPaid, markPaidSchema } from "@/server/services/payroll";

export const POST = route<{ id: string }>(async (req, { actor, params }) => ok(await markPaid(actor, params.id, await parseBody(req, markPaidSchema))));
