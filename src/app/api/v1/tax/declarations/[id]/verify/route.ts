import { ok, parseBody, route } from "@/lib/api";
import { verifyDeclaration, verifyDeclarationSchema } from "@/server/services/payroll";

export const POST = route<{ id: string }>(async (req, { actor, params }) => ok(await verifyDeclaration(actor, params.id, await parseBody(req, verifyDeclarationSchema))));
