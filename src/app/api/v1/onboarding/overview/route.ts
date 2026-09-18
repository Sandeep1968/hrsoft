import { ok, route } from "@/lib/api";
import { listOnboardingOverview } from "@/server/services/onboarding";

export const GET = route(async (_req, { actor }) => ok(await listOnboardingOverview(actor)));
