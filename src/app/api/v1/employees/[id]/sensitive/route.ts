import { ok, parseBody, route } from "@/lib/api";
import { updateSensitive, updateSensitiveSchema } from "@/server/services/employees";

export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateSensitive(actor, params.id, await parseBody(req, updateSensitiveSchema))));
