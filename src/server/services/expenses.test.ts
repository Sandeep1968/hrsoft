import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { loadActor, type Actor } from "@/lib/rbac/authorize";
import { ForbiddenError } from "@/lib/errors";
import { createClaim, decideClaim, deleteClaim, getClaim, listClaims, reimburseClaim, submitClaim, withdrawClaim } from "./expenses";

async function actorFor(email: string): Promise<Actor> {
  const u = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!u) throw new Error(`seed user ${email} missing`);
  const a = await loadActor(u.id);
  if (!a) throw new Error(`could not load actor ${email}`);
  return a;
}

describe("expenses service (seeded DB)", () => {
  let employee: Actor;
  let manager: Actor;
  let finance: Actor;
  let claimId: string;
  let adjustmentId: string | null = null;

  beforeAll(async () => {
    [employee, manager, finance] = await Promise.all([actorFor("employee@acme.example"), actorFor("manager@acme.example"), actorFor("finance@acme.example")]);
  });

  afterAll(async () => {
    if (claimId) await db.expenseClaim.deleteMany({ where: { id: claimId } });
    if (adjustmentId) await db.payrollAdjustment.deleteMany({ where: { id: adjustmentId } });
  });

  it("employee creates a draft claim and submits it to their manager", async () => {
    const cats = await db.expenseCategory.findMany({ where: { code: { in: ["TRAVEL", "MEALS"] } } });
    const travel = cats.find((c) => c.code === "TRAVEL")!;
    const meals = cats.find((c) => c.code === "MEALS")!;
    await expect(
      createClaim(employee, { title: "Over cap", currency: "INR", items: [{ categoryId: meals.id, date: new Date("2026-09-01T00:00:00.000Z"), amount: 5000 }] }),
    ).rejects.toThrow(/capped/);
    const claim = await createClaim(employee, {
      title: "Client visit — Hyderabad",
      currency: "INR",
      items: [
        { categoryId: travel.id, date: new Date("2026-09-10T00:00:00.000Z"), amount: 3200, merchant: "IndiGo", receiptKey: "receipts/test/flight.pdf" },
        { categoryId: meals.id, date: new Date("2026-09-10T00:00:00.000Z"), amount: 850, merchant: "Paradise", receiptKey: "receipts/test/lunch.pdf" },
      ],
    });
    claimId = claim.id;
    expect(claim.status).toBe("DRAFT");
    expect(claim.totalAmount).toBe(4050);
    expect(claim.items).toHaveLength(2);

    const submitted = await submitClaim(employee, claimId);
    expect(submitted.status).toBe("SUBMITTED");
    expect(submitted.approverId).toBe(manager.employeeId);
    expect(submitted.submittedAt).not.toBeNull();

    // withdraw + resubmit round-trip
    expect((await withdrawClaim(employee, claimId)).status).toBe("DRAFT");
    expect((await submitClaim(employee, claimId)).status).toBe("SUBMITTED");
  });

  it("employee cannot approve their own claim", async () => {
    await expect(decideClaim(employee, claimId, { decision: "APPROVED" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("manager sees it in the approval queue and approves", async () => {
    const queue = await listClaims(manager, { page: 1, pageSize: 50, order: "desc", view: "approve" });
    expect(queue.items.some((c) => c.id === claimId)).toBe(true);
    const decided = await decideClaim(manager, claimId, { decision: "APPROVED", note: "Looks good" });
    expect(decided.status).toBe("APPROVED");
    expect(decided.decisionNote).toBe("Looks good");
    expect(decided.decidedAt).not.toBeNull();
    await expect(decideClaim(manager, claimId, { decision: "REJECTED" })).rejects.toThrow(/not awaiting/);
  });

  it("finance reimburses via payroll, which creates a non-taxable REIMB adjustment", async () => {
    await expect(reimburseClaim(employee, claimId, { viaPayroll: false })).rejects.toBeInstanceOf(ForbiddenError);
    const r = await reimburseClaim(finance, claimId, { viaPayroll: true });
    expect(r.status).toBe("REIMBURSED");
    expect(r.paymentRef).toMatch(/^PAYROLL:/);
    adjustmentId = r.paymentRef!.slice("PAYROLL:".length);
    const adj = await db.payrollAdjustment.findUnique({ where: { id: adjustmentId } });
    expect(adj).not.toBeNull();
    expect(adj!.code).toBe("REIMB");
    expect(adj!.isTaxable).toBe(false);
    expect(Number(adj!.amount)).toBe(4050);
    expect(adj!.employeeId).toBe(employee.employeeId);
  });

  it("owner can read the claim; drafts only can be deleted", async () => {
    const c = await getClaim(employee, claimId);
    expect(c.status).toBe("REIMBURSED");
    await expect(deleteClaim(employee, claimId)).rejects.toThrow(/draft/i);
  });
});
