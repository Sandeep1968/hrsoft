import { ok, route } from "@/lib/api";
import { getPublicJob } from "@/server/services/hiring";

export const GET = route<{ slug: string }>(async (_req, { params }) => ok(await getPublicJob(params.slug)), { public: true });
