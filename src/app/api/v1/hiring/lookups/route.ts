import { ok, route } from "@/lib/api";
import { hiringLookups } from "@/server/services/hiring";

export const GET = route(async (_req, { actor }) => ok(await hiringLookups(actor)));
