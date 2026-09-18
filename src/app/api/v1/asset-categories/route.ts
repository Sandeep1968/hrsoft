import { created, ok, parseBody, route } from "@/lib/api";
import { assetCategorySchema, createAssetCategory, listAssetCategories } from "@/server/services/assets";

export const GET = route(async (_req, { actor }) => ok(await listAssetCategories(actor)));
export const POST = route(async (req, { actor }) => created(await createAssetCategory(actor, await parseBody(req, assetCategorySchema))));
