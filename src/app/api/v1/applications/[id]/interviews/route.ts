import { created, parseBody, route } from "@/lib/api";
import { scheduleInterview, scheduleInterviewSchema } from "@/server/services/hiring";

export const POST = route<{ id: string }>(async (req, { actor, params }) => created(await scheduleInterview(actor, params.id, await parseBody(req, scheduleInterviewSchema))));
