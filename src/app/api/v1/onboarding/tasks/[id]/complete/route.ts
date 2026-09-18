import { ok, route } from "@/lib/api";
import { completeTask, completeTaskSchema } from "@/server/services/onboarding";

export const POST = route<{ id: string }>(async (req, { actor, params }) => {
  const body = completeTaskSchema.parse(await req.json().catch(() => ({})));
  return ok(await completeTask(actor, params.id, body.status));
});
