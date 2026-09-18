import { ok, route } from "@/lib/api";
import { reportLookups } from "@/server/services/reports";

export const GET = route(async (_req, { actor }) => ok(await reportLookups(actor)));
