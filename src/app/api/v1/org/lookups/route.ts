import { ok, route } from "@/lib/api";
import { getOrgLookups } from "@/server/services/org";

export const GET = route(async (_req, { actor }) => ok(await getOrgLookups(actor)));
