import { ok, route } from "@/lib/api";
import { sendOffer } from "@/server/services/hiring";

export const POST = route<{ id: string }>(async (_req, { actor, params }) => ok(await sendOffer(actor, params.id)));
