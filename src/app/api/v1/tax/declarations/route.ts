import { ok, parseBody, parseQuery, route } from "@/lib/api";
import { can, requireEmployee } from "@/lib/rbac/authorize";
import { declarationSchema, declarationsQuerySchema, getDeclaration, listDeclarations, saveDeclaration } from "@/server/services/payroll";

/** Verifiers get the queue (?fy&status&q); everyone else gets their own declaration (?fy). */
export const GET = route(async (_req, { actor, query }) => {
  if (can(actor, "tax:verify") && query.get("mine") !== "1") return ok(await listDeclarations(actor, parseQuery(query, declarationsQuerySchema)));
  return ok(await getDeclaration(actor, requireEmployee(actor), query.get("fy") ?? undefined));
});
/** Save my declaration (DRAFT). */
export const POST = route(async (req, { actor }) => {
  const body = await parseBody(req, declarationSchema);
  return ok(await saveDeclaration(actor, body.employeeId ?? requireEmployee(actor), body));
});
