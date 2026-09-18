import { ok, parseBody, route } from "@/lib/api";
import { assetUpdateSchema, deleteAsset, getAsset, updateAsset } from "@/server/services/assets";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await getAsset(actor, params.id)));
export const PATCH = route<{ id: string }>(async (req, { actor, params }) => ok(await updateAsset(actor, params.id, await parseBody(req, assetUpdateSchema))));
export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => ok(await deleteAsset(actor, params.id)));
