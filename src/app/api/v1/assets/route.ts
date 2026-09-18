import { created, ok, parseBody, parseQuery, route } from "@/lib/api";
import { assetSchema, createAsset, listAssets, listAssetsSchema } from "@/server/services/assets";

export const GET = route(async (_req, { actor, query }) => ok(await listAssets(actor, parseQuery(query, listAssetsSchema))));
export const POST = route(async (req, { actor }) => created(await createAsset(actor, await parseBody(req, assetSchema))));
