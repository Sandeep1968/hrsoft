import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { loadActor, type Actor } from "@/lib/rbac/authorize";
import { ForbiddenError } from "@/lib/errors";
import { createRun, deleteRun, finalizeRun, getRun, listRunPayslips, processRun, reopenRun, getLopDays, payrollRegisterCsv, bankAdviceCsv } from "./payroll";

// A far-future month: every seeded employee has joined, nobody has exited, and
// there is no attendance data (LOP = 0) or real run to collide with.
const YEAR = 2031;
const MONTH = 1;

async function actorFor(email: string): Promise<Actor> {
  const u = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!u) throw new Error(`seed user ${email} missing`);
  const a = await loadActor(u.id);
  if (!a) throw new Error(`could not load actor ${email}`);
  return a;
}

describe("payroll service (seeded DB)", () => {
  let payroll: Actor;
  let finance: Actor;
  let entityId: string;
  let runId: string;

  beforeAll(async () => {
    [payroll, finance] = await Promise.all([actorFor("payroll@acme.example"), actorFor("finance@acme.example")]);
    const entity = await db.legalEntity.findFirst({ where: { isDefault: true }, select: { id: true } });
    if (!entity) throw new Error("no default legal entity");
    entityId = entity.id;
    // Clean up a previous aborted test run, if any.
    const stale = await db.payrollRun.findUnique({ where: { legalEntityId_month_year: { legalEntityId: entityId, month: MONTH, year: YEAR } } });
    if (stale) {
      await db.payslip.deleteMany({ where: { runId: stale.id } });
      await db.payrollRun.delete({ where: { id: stale.id } });
    }
  });

  afterAll(async () => {
    if (runId) {
      await db.payslip.deleteMany({ where: { runId } }).catch(() => {});
      await db.payrollRun.delete({ where: { id: runId } }).catch(() => {});
    }
  });

  it("creates a DRAFT run counting eligible employees", async () => {
    const run = await createRun(payroll, { legalEntityId: entityId, month: MONTH, year: YEAR });
    runId = run.id;
    expect(run.status).toBe("DRAFT");
    expect(run.employeeCount).toBeGreaterThan(1900);
    await expect(createRun(payroll, { legalEntityId: entityId, month: MONTH, year: YEAR })).rejects.toThrow(/already exists/);
  });

  it("finance cannot create runs", async () => {
    await expect(createRun(finance, { legalEntityId: entityId, month: 2, year: YEAR })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("processes every employee in under 60s with balanced payslips", async () => {
    const t0 = Date.now();
    const run = await processRun(payroll, runId);
    const ms = Date.now() - t0;
    console.info(`[payroll.test] processed ${run.processedCount} employees in ${(ms / 1000).toFixed(1)}s`);
    expect(ms).toBeLessThan(60_000);
    expect(run.status).toBe("REVIEW");
    expect(run.processedCount).toBe(run.employeeCount);
    expect(run.processedCount).toBeGreaterThan(1900);
    expect(run.payslipCount).toBe(run.employeeCount);
    expect(run.totalGross).toBeGreaterThan(0);
    expect(run.totalNet).toBeGreaterThan(0);
    expect(run.totalNet).toBeLessThan(run.totalGross);
    expect(run.statutory.pfEmployee).toBeGreaterThan(0);
    expect(run.statutory.professionalTax).toBeGreaterThan(0);
    expect(run.departments.length).toBeGreaterThan(1);
    expect(run.departments.reduce((a, d) => a + d.count, 0)).toBe(run.employeeCount);

    const page = await listRunPayslips(payroll, runId, { page: 3, pageSize: 25, order: "asc" });
    expect(page.total).toBe(run.employeeCount);
    const slip = page.items[Math.floor(Math.random() * page.items.length)];
    expect(slip.netPay).toBe(slip.gross - slip.totalDeductions);
    expect(slip.lopDays).toBe(0);
    expect(slip.payableDays).toBe(31);
    expect(Object.values(slip.earnings).reduce((a, b) => a + b, 0)).toBe(slip.gross);
    expect(Object.values(slip.deductions).reduce((a, b) => a + b, 0)).toBe(slip.totalDeductions);
    expect(slip.employerCost).toBe(slip.gross + Object.values(slip.employerContributions).reduce((a, b) => a + b, 0));
    // PF employee must equal 12% of min(basic, 15000)
    expect(slip.pfEmployee).toBe(Math.round(Math.min(slip.earnings.BASIC, 15000) * 0.12));
  }, 120_000);

  it("getLopDays returns 0 for a month with no attendance", async () => {
    const emp = await db.employee.findFirst({ where: { workEmail: "employee@acme.example" }, select: { id: true } });
    expect(await getLopDays(emp!.id, YEAR, MONTH)).toBe(0);
  });

  it("blocks finalize for an actor without payroll:finalize", async () => {
    await expect(finalizeRun(finance, runId)).rejects.toBeInstanceOf(ForbiddenError);
    const run = await getRun(payroll, runId);
    expect(run.status).toBe("REVIEW");
  });

  it("exports the register and bank advice with decrypted account numbers", async () => {
    const reg = await payrollRegisterCsv(payroll, runId);
    const lines = reg.content.trim().split("\r\n");
    expect(lines.length).toBeGreaterThan(1900);
    expect(lines[0]).toContain("Net Pay");
    await expect(bankAdviceCsv(finance, runId)).rejects.toBeInstanceOf(ForbiddenError);
    const bank = await bankAdviceCsv(payroll, runId);
    const first = bank.content.split("\r\n")[1].split(",");
    expect(first[4]).toMatch(/^\d{10,16}$/);
  }, 60_000);

  it("reopens a REVIEW run back to DRAFT and deletes it", async () => {
    const reopened = await reopenRun(payroll, runId);
    expect(reopened.status).toBe("DRAFT");
    expect(await db.payslip.count({ where: { runId } })).toBe(0);
    await deleteRun(payroll, runId);
    expect(await db.payrollRun.findUnique({ where: { id: runId } })).toBeNull();
    runId = "";
  });
});
