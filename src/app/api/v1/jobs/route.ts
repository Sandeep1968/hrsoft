import { created, ok, parseBody, parseQuery, route } from "@/lib/api";
import { createJob, jobSchema, listJobs, listJobsSchema } from "@/server/services/hiring";

export const GET = route(async (_req, { actor, query }) => ok(await listJobs(actor, parseQuery(query, listJobsSchema))));
export const POST = route(async (req, { actor }) => created(await createJob(actor, await parseBody(req, jobSchema))));
