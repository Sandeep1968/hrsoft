import "server-only";
import { db } from "@/lib/db";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { type Permission, type Scope, SCOPE_RANK } from "@/lib/rbac/permissions";

/** The authenticated principal every service function receives. */
export interface Actor {
  userId: string;
  email: string;
  name: string;
  employeeId: string | null;
  roles: string[];
  /** permission -> widest granted scope */
  perms: Map<Permission, Scope>;
  /** Cached ids of all direct + indirect reports (resolved lazily). */
  _teamIds?: Set<string>;
  /** Set when the request was authenticated with an API key (its scopes limit perms). */
  apiKeyId?: string;
  ip?: string;
}

export const SYSTEM_ACTOR: Actor = {
  userId: "00000000-0000-0000-0000-000000000000",
  email: "system@hrsoft.local",
  name: "System",
  employeeId: null,
  roles: ["SYSTEM"],
  perms: new Map(),
};

/** Build an Actor from a user id by merging all of their role grants. */
export async function loadActor(userId: string): Promise<Actor | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      employee: { select: { id: true } },
      roles: { select: { role: { select: { key: true, permissions: { select: { permission: true, scope: true } } } } } },
    },
  });
  if (!user || user.status === "SUSPENDED") return null;
  const perms = new Map<Permission, Scope>();
  const roles: string[] = [];
  for (const ur of user.roles) {
    roles.push(ur.role.key);
    for (const rp of ur.role.permissions) {
      const p = rp.permission as Permission;
      const existing = perms.get(p);
      if (!existing || SCOPE_RANK[rp.scope] > SCOPE_RANK[existing]) perms.set(p, rp.scope);
    }
  }
  return { userId: user.id, email: user.email, name: user.name, employeeId: user.employee?.id ?? null, roles, perms };
}

/** Narrow an actor's permissions to those an API key is allowed to use. */
export function restrictToScopes(actor: Actor, scopes: string[]): Actor {
  if (scopes.includes("*")) return actor;
  const perms = new Map<Permission, Scope>();
  for (const [p, s] of actor.perms) if (scopes.includes(p)) perms.set(p, s);
  return { ...actor, perms };
}

export function scopeOf(actor: Actor, permission: Permission): Scope | null {
  if (actor === SYSTEM_ACTOR) return "ALL";
  return actor.perms.get(permission) ?? null;
}

export function can(actor: Actor, permission: Permission, minScope: Scope = "SELF"): boolean {
  const s = scopeOf(actor, permission);
  return s !== null && SCOPE_RANK[s] >= SCOPE_RANK[minScope];
}

/** All direct and indirect reports of an employee (recursive CTE, capped at depth 12). */
export async function reportsOf(employeeId: string): Promise<Set<string>> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE tree AS (
      SELECT id, 1 AS depth FROM "Employee" WHERE "managerId" = ${employeeId}::uuid
      UNION ALL
      SELECT e.id, t.depth + 1 FROM "Employee" e JOIN tree t ON e."managerId" = t.id WHERE t.depth < 12
    )
    SELECT id FROM tree`;
  return new Set(rows.map((r) => r.id));
}

export async function teamIds(actor: Actor): Promise<Set<string>> {
  if (!actor.employeeId) return new Set();
  if (!actor._teamIds) actor._teamIds = await reportsOf(actor.employeeId);
  return actor._teamIds;
}

export async function isInTeam(actor: Actor, employeeId: string): Promise<boolean> {
  if (actor.employeeId === employeeId) return true;
  return (await teamIds(actor)).has(employeeId);
}

/**
 * Assert the actor holds `permission` for the target employee (or, when no
 * target is given, holds it at least at `minScope`). Throws ForbiddenError.
 */
export async function authorize(
  actor: Actor | null | undefined,
  permission: Permission,
  opts: { employeeId?: string | null; minScope?: Scope } = {},
): Promise<Scope> {
  if (!actor) throw new UnauthorizedError();
  const scope = scopeOf(actor, permission);
  if (!scope) throw new ForbiddenError(`Missing permission ${permission}`);
  if (opts.minScope && SCOPE_RANK[scope] < SCOPE_RANK[opts.minScope]) {
    throw new ForbiddenError(`Permission ${permission} requires ${opts.minScope} scope`);
  }
  if (opts.employeeId && scope !== "ALL") {
    if (scope === "SELF" && actor.employeeId !== opts.employeeId) {
      throw new ForbiddenError("You can only access your own records");
    }
    if (scope === "TEAM" && !(await isInTeam(actor, opts.employeeId))) {
      throw new ForbiddenError("This employee is not in your team");
    }
  }
  return scope;
}

/**
 * Returns a Prisma `where` fragment restricting a query to the employees the
 * actor may see under `permission`, using the given employee-id column name.
 * ALL → {} ; TEAM → { col: { in: [self, ...reports] } } ; SELF → { col: self }.
 */
export async function scopeFilter(
  actor: Actor,
  permission: Permission,
  column = "employeeId",
): Promise<Record<string, unknown>> {
  const scope = await authorize(actor, permission);
  if (scope === "ALL") return {};
  if (scope === "SELF") return { [column]: actor.employeeId ?? "00000000-0000-0000-0000-000000000000" };
  const ids = [...(await teamIds(actor))];
  if (actor.employeeId) ids.push(actor.employeeId);
  return { [column]: { in: ids } };
}

/** Same as scopeFilter but returns the visible employee ids (null = unrestricted). */
export async function visibleEmployeeIds(actor: Actor, permission: Permission): Promise<string[] | null> {
  const scope = await authorize(actor, permission);
  if (scope === "ALL") return null;
  if (scope === "SELF") return actor.employeeId ? [actor.employeeId] : [];
  const ids = [...(await teamIds(actor))];
  if (actor.employeeId) ids.push(actor.employeeId);
  return ids;
}

export function requireEmployee(actor: Actor): string {
  if (!actor.employeeId) throw new ForbiddenError("This action requires an employee profile");
  return actor.employeeId;
}
