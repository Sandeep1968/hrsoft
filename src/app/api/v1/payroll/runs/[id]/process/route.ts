import { ok, route } from "@/lib/api";
import { processRun } from "@/server/services/payroll";

/** Starts processing and returns immediately; the client polls GET /payroll/runs/:id. Pass ?wait=1 to block until done. */
export const POST = route<{ id: string }>(async (_req, { actor, params, query }) => ok(await processRun(actor, params.id, { wait: query.get("wait") === "1" })));
