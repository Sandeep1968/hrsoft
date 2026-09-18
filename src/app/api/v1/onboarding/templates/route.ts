import { created, ok, parseBody, route } from "@/lib/api";
import { createTemplate, listTemplates, templateSchema } from "@/server/services/onboarding";

export const GET = route(async (_req, { actor }) => ok(await listTemplates(actor)));
export const POST = route(async (req, { actor }) => created(await createTemplate(actor, await parseBody(req, templateSchema))));
