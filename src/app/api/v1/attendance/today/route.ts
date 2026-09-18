import { ok, route } from "@/lib/api";
import { getToday } from "@/server/services/attendance";

export const GET = route(async (_req, { actor }) => ok(await getToday(actor)));
