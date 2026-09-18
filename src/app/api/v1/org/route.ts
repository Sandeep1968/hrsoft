import { ok, parseBody, route } from "@/lib/api";
import { getOrganization, organizationSchema, updateOrganization } from "@/server/services/org";

export const GET = route(async (_req, { actor }) => ok(await getOrganization(actor)));
export const PATCH = route(async (req, { actor }) => ok(await updateOrganization(actor, await parseBody(req, organizationSchema))));
