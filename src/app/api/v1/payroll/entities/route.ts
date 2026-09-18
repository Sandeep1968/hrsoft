import { ok, route } from "@/lib/api";
import { listLegalEntities } from "@/server/services/payroll";

export const GET = route(async (_req, { actor }) => ok(await listLegalEntities(actor)));
