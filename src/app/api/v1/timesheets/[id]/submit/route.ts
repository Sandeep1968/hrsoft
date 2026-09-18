import { ok, route } from "@/lib/api";
import { submitTimesheet } from "@/server/services/timesheets";

export const POST = route<{ id: string }>(async (_req, { actor, params }) => ok(await submitTimesheet(actor, params.id)));
