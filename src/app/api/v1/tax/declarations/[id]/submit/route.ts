import { ok, route } from "@/lib/api";
import { submitDeclaration } from "@/server/services/payroll";

export const POST = route<{ id: string }>(async (_req, { actor, params }) => ok(await submitDeclaration(actor, params.id)));
