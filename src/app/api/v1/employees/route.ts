import { created, ok, parseBody, parseQuery, route } from "@/lib/api";
import { createEmployee, createEmployeeSchema, exportEmployeesCsv, listEmployees, listEmployeesSchema } from "@/server/services/employees";

/** GET /api/v1/employees — paginated directory. `?format=csv` streams up to 5000 rows (needs reports:export). */
export const GET = route(async (_req, { actor, query }) => {
  const params = parseQuery(query, listEmployeesSchema);
  if (params.format === "csv") {
    const csv = await exportEmployeesCsv(actor, params);
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="employees-${new Date().toISOString().slice(0, 10)}.csv"` } });
  }
  return ok(await listEmployees(actor, params));
});

export const POST = route(async (req, { actor }) => created(await createEmployee(actor, await parseBody(req, createEmployeeSchema))));
