import { ok, route } from "@/lib/api";
import { listMyInterviews } from "@/server/services/hiring";

export const GET = route(async (_req, { actor }) => ok(await listMyInterviews(actor)));
