import { ok, route } from "@/lib/api";
import { assetLookups } from "@/server/services/assets";

export const GET = route(async (_req, { actor }) => ok(await assetLookups(actor)));
