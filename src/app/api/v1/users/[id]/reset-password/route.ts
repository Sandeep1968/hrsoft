import { ok, route } from "@/lib/api";
import { adminResetPassword } from "@/server/services/users";

export const POST = route<{ id: string }>(async (_req, { actor, params }) => ok(await adminResetPassword(actor, params.id)));
