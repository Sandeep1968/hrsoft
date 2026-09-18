import { ok, parseQuery, route } from "@/lib/api";
import { listAuditLogs, listAuditSchema } from "@/server/services/auditlog";

export const GET = route(async (_req, { actor, query }) => ok(await listAuditLogs(actor, parseQuery(query, listAuditSchema))));
