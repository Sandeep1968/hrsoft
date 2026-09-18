import { z } from "zod";
import { created, ok, parseBody, parseQuery, route } from "@/lib/api";
import { listExits, requestExit, requestExitSchema } from "@/server/services/exits";

const listSchema = z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(), page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(200).optional() });

export const GET = route(async (_req, { actor, query }) => ok(await listExits(actor, parseQuery(query, listSchema))));
export const POST = route(async (req, { actor }) => created(await requestExit(actor, await parseBody(req, requestExitSchema))));
