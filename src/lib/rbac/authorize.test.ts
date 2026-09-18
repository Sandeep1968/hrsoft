import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { authorize, can, loadActor, scopeFilter, teamIds, visibleEmployeeIds, type Actor } from "./authorize";

async function actorFor(email: string): Promise<Actor> {
  const u = await db.user.findUniqueOrThrow({ where: { email } });
  const a = await loadActor(u.id);
  if (!a) throw new Error("no actor");
  return a;
}

describe("RBAC authorize (seeded DB)", () => {
  it("merges the widest scope across roles", async () => {
    const manager = await actorFor("manager@acme.example");
    expect(manager.roles.sort()).toEqual(["EMPLOYEE", "MANAGER"]);
    expect(manager.perms.get("leave:read")).toBe("TEAM");
    expect(manager.perms.get("employees:read")).toBe("ALL");
    expect(manager.perms.get("payroll:run")).toBeUndefined();
    const admin = await actorFor("admin@acme.example");
    expect(admin.perms.get("payroll:run")).toBe("ALL");
    expect(can(admin, "rbac:manage")).toBe(true);
    expect(can(manager, "rbac:manage")).toBe(false);
  });

  it("SELF scope only allows own records", async () => {
    const emp = await actorFor("employee@acme.example");
    const mgr = await actorFor("manager@acme.example");
    await expect(authorize(emp, "leave:read", { employeeId: emp.employeeId })).resolves.toBe("SELF");
    await expect(authorize(emp, "leave:read", { employeeId: mgr.employeeId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(authorize(emp, "payroll:run")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("TEAM scope covers direct and indirect reports but not peers", async () => {
    const mgr = await actorFor("manager@acme.example");
    const emp = await actorFor("employee@acme.example");
    const team = await teamIds(mgr);
    expect(team.has(emp.employeeId!)).toBe(true);
    await expect(authorize(mgr, "leave:approve", { employeeId: emp.employeeId })).resolves.toBe("TEAM");
    const hr = await actorFor("hr@acme.example");
    await expect(authorize(mgr, "leave:approve", { employeeId: hr.employeeId })).rejects.toBeInstanceOf(ForbiddenError);
    const filter = await scopeFilter(mgr, "attendance:read");
    expect((filter.employeeId as { in: string[] }).in).toContain(emp.employeeId);
    expect((filter.employeeId as { in: string[] }).in).toContain(mgr.employeeId);
  });

  it("ALL scope returns an unrestricted filter", async () => {
    const hr = await actorFor("hr@acme.example");
    expect(await scopeFilter(hr, "attendance:read")).toEqual({});
    expect(await visibleEmployeeIds(hr, "employees:read")).toBeNull();
  });

  it("suspended users cannot load an actor", async () => {
    const u = await db.user.findUniqueOrThrow({ where: { email: "employee@acme.example" } });
    await db.user.update({ where: { id: u.id }, data: { status: "SUSPENDED" } });
    try {
      expect(await loadActor(u.id)).toBeNull();
    } finally {
      await db.user.update({ where: { id: u.id }, data: { status: "ACTIVE" } });
    }
  });
});
