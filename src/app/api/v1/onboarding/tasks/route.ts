import { created, ok, parseBody, route } from "@/lib/api";
import { addTask, addTaskSchema, listEmployeeOnboardingTasks, listMyOnboardingTasks } from "@/server/services/onboarding";

/** GET mine (own record + MANAGER tasks for reports); `?employeeId=` lists a specific employee's tasks. */
export const GET = route(async (_req, { actor, query }) => {
  const employeeId = query.get("employeeId");
  return ok(employeeId ? await listEmployeeOnboardingTasks(actor, employeeId) : await listMyOnboardingTasks(actor));
});
export const POST = route(async (req, { actor }) => created(await addTask(actor, await parseBody(req, addTaskSchema))));
