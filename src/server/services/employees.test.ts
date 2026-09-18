import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { type Actor } from "@/lib/rbac/authorize";
import { ForbiddenError } from "@/lib/errors";
import { addDays, todayUtc } from "@/lib/dates";
import { actorFor, rand } from "@/server/services/_test-helpers";
import {
  computeMonthlyFromStructure,
  createEmployee,
  employeeCodePrefix,
  getEmployee,
  initialLeaveAccrual,
  initialStatus,
  listEmployees,
  orgChart,
  updateEmployee,
  updateSensitive,
} from "@/server/services/employees";
import { listEmployeeOnboardingTasks } from "@/server/services/onboarding";

describe("employees — pure helpers", () => {
  it("computes monthly salary from the standard structure", () => {
    const { monthly, gross } = computeMonthlyFromStructure(1_200_000, [
      { code: "BASIC", type: "EARNING", calcType: "PERCENT_OF_CTC", value: 40, order: 1 },
      { code: "HRA", type: "EARNING", calcType: "PERCENT_OF_BASIC", value: 50, order: 2 },
      { code: "CONV", type: "EARNING", calcType: "FIXED", value: 1600, order: 3 },
      { code: "SPECIAL", type: "EARNING", calcType: "BALANCE", value: 0, order: 4 },
    ]);
    expect(monthly.BASIC).toBe(40000);
    expect(monthly.HRA).toBe(20000);
    expect(monthly.CONV).toBe(1600);
    expect(monthly.SPECIAL).toBe(38400);
    expect(gross).toBe(100000);
  });

  it("pro-rates accrual by remaining months and uses full quota for non-accruing types", () => {
    expect(initialLeaveAccrual({ annualQuota: 12, accrualPerMonth: 1 }, new Date("2026-10-01T00:00:00Z"), 2026)).toBe(3);
    expect(initialLeaveAccrual({ annualQuota: 12, accrualPerMonth: 1 }, new Date("2020-03-01T00:00:00Z"), 2026)).toBe(12);
    expect(initialLeaveAccrual({ annualQuota: 12, accrualPerMonth: 1 }, new Date("2027-03-01T00:00:00Z"), 2026)).toBe(0);
    expect(initialLeaveAccrual({ annualQuota: 182, accrualPerMonth: 0 }, new Date("2026-10-01T00:00:00Z"), 2026)).toBe(182);
  });

  it("derives status and code prefix", () => {
    const today = todayUtc();
    expect(initialStatus(addDays(today, 10), today)).toBe("ONBOARDING");
    expect(initialStatus(addDays(today, -10), today)).toBe("ONBOARDING");
    expect(initialStatus(addDays(today, -45), today)).toBe("ACTIVE");
    expect(employeeCodePrefix("Acme Technologies")).toBe("AT");
    expect(employeeCodePrefix("Globex")).toBe("GLO");
    expect(employeeCodePrefix("")).toBe("EMP");
  });
});

describe("employees service (seeded DB)", () => {
  let admin: Actor;
  let employee: Actor;
  let manager: Actor;
  const created: { id: string; userId: string | null }[] = [];
  const tag = rand("HRT").toLowerCase();

  beforeAll(async () => {
    [admin, employee, manager] = await Promise.all([actorFor("admin@acme.example"), actorFor("employee@acme.example"), actorFor("manager@acme.example")]);
  });

  afterAll(async () => {
    for (const c of created) {
      await db.employee.delete({ where: { id: c.id } }).catch(() => {});
      if (c.userId) await db.user.delete({ where: { id: c.userId } }).catch(() => {});
    }
  });

  it("creates an employee with user, salary, leave balances, onboarding tasks and job history", async () => {
    const dept = await db.department.findFirstOrThrow({ where: { isActive: true }, select: { id: true } });
    const r = await createEmployee(admin, {
      firstName: "Test",
      lastName: `Joiner ${tag}`,
      workEmail: `${tag}.one@acme.example`,
      joiningDate: addDays(todayUtc(), 7),
      gender: "FEMALE",
      departmentId: dept.id,
      managerId: manager.employeeId!,
      annualCtc: 900_000,
      createUser: true,
      sendInvite: false,
    });
    created.push({ id: r.id, userId: r.userId });
    expect(r.employeeCode).toMatch(/^[A-Z]{2,3}\d{5}$/);
    expect(r.userId).toBeTruthy();
    expect(r.tempPassword).toBeTruthy();

    const emp = await db.employee.findUniqueOrThrow({ where: { id: r.id }, include: { user: { include: { roles: { include: { role: true } } } }, salaries: true, leaveBalances: { include: { leaveType: true } }, onboardingTasks: true, jobHistory: true, legalEntity: true, shift: true } });
    expect(emp.status).toBe("ONBOARDING");
    expect(emp.user?.status).toBe("INVITED");
    expect(emp.user?.mustChangePassword).toBe(true);
    expect(emp.user?.roles.map((x) => x.role.key)).toContain("EMPLOYEE");
    expect(emp.legalEntity?.isDefault).toBe(true);
    expect(emp.shift?.isDefault).toBe(true);
    expect(emp.salaries).toHaveLength(1);
    expect(Number(emp.salaries[0].annualCtc)).toBe(900_000);
    expect((emp.salaries[0].monthly as Record<string, number>).BASIC).toBe(30000);
    expect(emp.leaveBalances.length).toBeGreaterThan(0);
    expect(emp.leaveBalances.some((b) => b.leaveType.code === "PL")).toBe(false); // male-only type excluded
    expect(emp.leaveBalances.some((b) => b.leaveType.code === "ML")).toBe(true);
    expect(emp.onboardingTasks.length).toBeGreaterThan(0);
    expect(emp.jobHistory).toHaveLength(1);
    expect(emp.jobHistory[0].reason).toBe("Joined");

    // Manager keeps/gets the MANAGER role.
    const mgrUser = await db.user.findUniqueOrThrow({ where: { id: manager.userId }, include: { roles: { include: { role: true } } } });
    expect(mgrUser.roles.map((x) => x.role.key)).toContain("MANAGER");
  });

  it("allocates unique codes across consecutive creates", async () => {
    const a = await createEmployee(admin, { firstName: "A", lastName: tag, workEmail: `${tag}.two@acme.example`, joiningDate: todayUtc(), createUser: false });
    const b = await createEmployee(admin, { firstName: "B", lastName: tag, workEmail: `${tag}.three@acme.example`, joiningDate: todayUtc(), createUser: false });
    created.push({ id: a.id, userId: a.userId }, { id: b.id, userId: b.userId });
    expect(a.employeeCode).not.toBe(b.employeeCode);
    expect(a.userId).toBeNull();
    await expect(createEmployee(admin, { firstName: "Dup", lastName: tag, workEmail: `${tag}.two@acme.example`, joiningDate: todayUtc() })).rejects.toThrow(/already exists/);
  });

  it("masks sensitive fields for an EMPLOYEE viewing someone else, reveals for self and admin", async () => {
    const target = created[0].id;
    await updateSensitive(admin, target, { pan: "ABCDE1234F", bank: { accountHolder: "Test", accountNumber: "123456789012", ifsc: "HDFC0001234", bankName: "HDFC" } });
    const asAdmin = await getEmployee(admin, target);
    expect(asAdmin.sensitive.unmasked).toBe(true);
    expect(asAdmin.sensitive.pan).toBe("ABCDE1234F");
    expect(asAdmin.sensitive.bank?.accountNumber).toBe("123456789012");

    // employee:read is ALL for EMPLOYEE, so the profile loads; read_sensitive is SELF, so values are masked.
    const asEmployee = await getEmployee(employee, target);
    expect(asEmployee.sensitive.unmasked).toBe(false);
    expect(asEmployee.sensitive.pan).toBe("******234F");
    expect(asEmployee.sensitive.bank?.accountNumber).toBe("********9012");

    const self = await getEmployee(employee, employee.employeeId!);
    expect(self.sensitive.unmasked).toBe(true);
  });

  it("enforces self-service boundaries on updates", async () => {
    const target = created[0].id;
    await expect(updateEmployee(employee, target, { phone: "+911111111111" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateEmployee(employee, employee.employeeId!, { departmentId: null })).rejects.toBeInstanceOf(ForbiddenError);
    const before = await db.employee.findUniqueOrThrow({ where: { id: employee.employeeId! }, select: { phone: true } });
    const updated = await updateEmployee(employee, employee.employeeId!, { phone: "+919999999999" });
    expect(updated.phone).toBe("+919999999999");
    await db.employee.update({ where: { id: employee.employeeId! }, data: { phone: before.phone } });
  });

  it("appends job history on manager change and lists reports / org chart", async () => {
    const target = created[1].id;
    const r = await updateEmployee(admin, target, { managerId: manager.employeeId!, reason: "Transfer", effectiveFrom: new Date("2026-09-01T00:00:00Z") });
    expect(r.managerId).toBe(manager.employeeId);
    const transfer = r.jobHistory.find((h) => h.reason === "Transfer");
    expect(transfer).toBeTruthy();
    expect(transfer?.manager).toBeTruthy();
    expect(transfer?.effectiveFrom).toBe("2026-09-01");
    const page = await listEmployees(admin, { page: 1, pageSize: 10, q: tag, managerId: manager.employeeId! });
    expect(page.items.some((i) => i.id === target)).toBe(true);
    const nodes = await orgChart(admin, manager.employeeId);
    expect(nodes[0]?.id).toBe(manager.employeeId);
    expect(nodes.some((n) => n.id === target)).toBe(true);
    // Manager (TEAM scope on onboarding:read) can see the new report's checklist.
    const tasks = await listEmployeeOnboardingTasks(manager, created[0].id);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.filter((t) => t.assigneeType === "MANAGER").every((t) => t.canComplete)).toBe(true);
  });
});
