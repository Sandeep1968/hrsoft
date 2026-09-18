import { ok, route } from "@/lib/api";
import { slaReport } from "@/server/services/helpdesk";

export const GET = route(async (_req, { actor }) => ok(await slaReport(actor)));
