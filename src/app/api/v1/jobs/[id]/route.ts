import { ok, parseBody, route } from "@/lib/api";
import { getJob, updateJob, updateJobSchema } from "@/server/services/hiring";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await getJob(actor, params.id)));
export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateJob(actor, params.id, await parseBody(req, updateJobSchema))));
