import { ok, parseBody, route } from "@/lib/api";
import { assetCategorySchema, deleteAssetCategory, updateAssetCategory } from "@/server/services/assets";

export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateAssetCategory(actor, params.id, await parseBody(req, assetCategorySchema))));
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => ok(await deleteAssetCategory(actor, params.id)));
