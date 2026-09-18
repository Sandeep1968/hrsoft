import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { loadActor, type Actor } from "@/lib/rbac/authorize";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import { actorFor, rand } from "./_test-helpers";
import { assignRoles, createRole, deleteRole, getRole, listRoles, permissionMatrix, updateRole } from "./rbac";

describe("rbac service (DB)", () => {
  let admin: Actor;
  let employeeUserId: string;
  let originalRoleKeys: string[] = [];
  let roleId: string | null = null;
  const roleKey = rand("QA_ROLE_");

  beforeAll(async () => {
    admin = await actorFor("admin@acme.example");
    const emp = await db.user.findUnique({ where: { email: "employee@acme.example" }, select: { id: true, roles: { select: { role: { select: { key: true } } } } } });
    if (!emp) throw new Error("employee@ not seeded");
    employeeUserId = emp.id;
    originalRoleKeys = emp.roles.map((r) => r.role.key);
  });

  afterAll(async () => {
    if (employeeUserId) await assignRoles(admin, employeeUserId, originalRoleKeys).catch(() => {});
    if (roleId) await db.role.delete({ where: { id: roleId } }).catch(() => {});
  });

  it("creates a custom role with two grants", async () => {
    const role = await createRole(admin, { key: roleKey, name: "QA role", description: "temporary", grants: [{ permission: "leave:read", scope: "TEAM" }, { permission: "attendance:write", scope: "ALL" }] });
    roleId = role.id;
    expect(role.key).toBe(roleKey);
    expect(role.isSystem).toBe(false);
    expect(role.grants).toHaveLength(2);
    const listed = (await listRoles(admin)).find((r) => r.id === role.id);
    expect(listed?.permissionCount).toBe(2);
    expect(listed?.userCount).toBe(0);
  });

  it("assigning the role merges the widest scope into loadActor", async () => {
    const before = await loadActor(employeeUserId);
    expect(before?.perms.get("leave:read")).toBe("SELF");
    expect(before?.perms.get("attendance:write")).toBeUndefined();

    await assignRoles(admin, employeeUserId, [...originalRoleKeys, roleKey]);
    const after = await loadActor(employeeUserId);
    expect(after?.roles).toContain(roleKey);
    expect(after?.perms.get("leave:read")).toBe("TEAM");
    expect(after?.perms.get("attendance:write")).toBe("ALL");
    // Other grants from EMPLOYEE are untouched.
    expect(after?.perms.get("leave:apply")).toBe("SELF");
  });

  it("refuses to delete a role that still has users", async () => {
    await expect(deleteRole(admin, roleId!)).rejects.toBeInstanceOf(ConflictError);
  });

  it("appears in the permission matrix", async () => {
    const m = await permissionMatrix(admin);
    expect(m.roles.some((r) => r.key === roleKey)).toBe(true);
    const leave = m.modules.find((x) => x.module === "leave")!.permissions.find((p) => p.permission === "leave:read")!;
    expect(leave.scopes[roleKey]).toBe("TEAM");
    expect(leave.scopes.SUPER_ADMIN).toBe("ALL");
  });

  it("SUPER_ADMIN grants are immutable but name/description remain editable", async () => {
    const sa = (await listRoles(admin)).find((r) => r.key === "SUPER_ADMIN")!;
    await expect(updateRole(admin, sa.id, { grants: [{ permission: "org:read", scope: "ALL" }] })).rejects.toBeInstanceOf(ForbiddenError);
    const updated = await updateRole(admin, sa.id, { description: sa.description ?? undefined });
    expect(updated.grants.length).toBeGreaterThan(50);
  });

  it("cannot remove your own SUPER_ADMIN role", async () => {
    await expect(assignRoles(admin, admin.userId, ["EMPLOYEE"])).rejects.toBeInstanceOf(ForbiddenError);
    const still = await getRole(admin, (await listRoles(admin)).find((r) => r.key === "SUPER_ADMIN")!.id);
    expect(still.userCount).toBeGreaterThanOrEqual(1);
  });

  it("cleans up: restore roles then delete the custom role", async () => {
    await assignRoles(admin, employeeUserId, originalRoleKeys);
    const restored = await loadActor(employeeUserId);
    expect(restored?.roles.sort()).toEqual([...originalRoleKeys].sort());
    await deleteRole(admin, roleId!);
    const gone = await db.role.findUnique({ where: { id: roleId! } });
    expect(gone).toBeNull();
    roleId = null;
  });
});
