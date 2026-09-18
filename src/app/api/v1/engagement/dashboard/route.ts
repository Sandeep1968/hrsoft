import { ok, route } from "@/lib/api";
import { engagementDashboard } from "@/server/services/engagement";

export const GET = route(async (_req, { actor }) => ok(await engagementDashboard(actor)));
