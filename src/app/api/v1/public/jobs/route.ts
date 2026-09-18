import { ok, route } from "@/lib/api";
import { listPublicJobs } from "@/server/services/hiring";

export const GET = route(async () => ok(await listPublicJobs()), { public: true });
