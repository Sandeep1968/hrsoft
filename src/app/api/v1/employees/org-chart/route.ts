import { ok, route } from "@/lib/api";
import { orgChart } from "@/server/services/employees";

export const GET = route(async (_req, { actor, query }) => ok(await orgChart(actor, query.get("root"))));
