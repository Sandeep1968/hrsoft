import { ok, parseBody, route } from "@/lib/api";
import { getCandidate, updateCandidate, updateCandidateSchema } from "@/server/services/hiring";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await getCandidate(actor, params.id)));
export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateCandidate(actor, params.id, await parseBody(req, updateCandidateSchema))));
