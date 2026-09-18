import { ok, route } from "@/lib/api";
import { myAssets } from "@/server/services/assets";

export const GET = route(async (_req, { actor }) => ok(await myAssets(actor)));
