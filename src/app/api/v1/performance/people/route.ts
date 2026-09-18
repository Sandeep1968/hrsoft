import { ok, route } from "@/lib/api";
import { searchEmployees } from "@/server/services/performance";

/** Lightweight employee picker used by OKR / feedback / praise / interview forms. */
export const GET = route(async (_req, { actor, query }) => ok(await searchEmployees(actor, query.get("q") ?? "", Math.min(Number(query.get("take") ?? 20), 50))));
