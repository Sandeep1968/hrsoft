import { ok, route } from "@/lib/api";
import { listPendingApprovals } from "@/server/services/approvals";

export const GET = route(async (_req, { actor }) => ok(await listPendingApprovals(actor)));
