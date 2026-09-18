import { ok, route } from "@/lib/api";
import { listReports } from "@/server/services/employees";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await listReports(actor, params.id)));
