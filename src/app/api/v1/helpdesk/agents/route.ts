import { ok, route } from "@/lib/api";
import { listAgents } from "@/server/services/helpdesk";

export const GET = route(async (_req, { actor }) => ok(await listAgents(actor)));
