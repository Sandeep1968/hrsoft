import { ok, route } from "@/lib/api";
import { auditActions } from "@/server/services/auditlog";

export const GET = route(async (_req, { actor }) => ok(await auditActions(actor)));
