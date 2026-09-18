import { ok, route } from "@/lib/api";
import { assetsSummary } from "@/server/services/assets";

export const GET = route(async (_req, { actor }) => ok(await assetsSummary(actor)));
