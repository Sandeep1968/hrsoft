import { ok, route } from "@/lib/api";
import { expenseSummary } from "@/server/services/expenses";

export const GET = route(async (_req, { actor }) => ok(await expenseSummary(actor)));
