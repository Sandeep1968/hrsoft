import { ok, route } from "@/lib/api";
import { hiringFunnel } from "@/server/services/hiring";

export const GET = route(async (_req, { actor }) => ok(await hiringFunnel(actor)));
