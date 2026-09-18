import { ok, route } from "@/lib/api";
import { searchEmployees } from "@/server/services/employees";

export const GET = route(async (_req, { actor, query }) => ok(await searchEmployees(actor, query.get("q") ?? "", Number(query.get("limit") ?? 10))));
