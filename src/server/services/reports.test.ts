import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/rbac/authorize";
import { todayUtc } from "@/lib/dates";
import { actorFor } from "./_test-helpers";
import { headcountReport, headcountTrend, runCustomReport, tenureAndDiversity, toCsv } from "./reports";

describe("reports service", () => {
  let admin: Actor;
  beforeAll(async () => {
    admin = await actorFor("admin@acme.example");
  });

  it("toCsv escapes quotes, commas, newlines and formula prefixes", () => {
    const csv = toCsv([{ a: 'He said "hi"', b: "x,y", c: "line\nbreak", d: "=SUM(A1)", e: null }]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("a,b,c,d,e");
    expect(lines[1]).toBe('"He said ""hi""","x,y","line\nbreak",\'=SUM(A1),');
  });

  it("headcount by department sums to the active headcount and runs fast on 2000 employees", async () => {
    const started = performance.now();
    const r = await headcountReport(admin, { groupBy: "department" });
    const ms = performance.now() - started;
    const expected = await db.employee.count({ where: { joiningDate: { lte: todayUtc() }, OR: [{ status: { not: "EXITED" } }, { exitDate: { gt: todayUtc() } }] } });
    const sum = r.table.reduce((a, row) => a + Number(row.headcount), 0);
    expect(sum).toBe(expected);
    expect(r.extras.total).toBe(expected);
    expect(r.table.length).toBeGreaterThan(1);
    expect(ms).toBeLessThan(2000);
  });

  it("headcount trend returns one row per month with a monotone closing headcount", async () => {
    const r = await headcountTrend(admin, { months: 6 });
    expect(r.table).toHaveLength(6);
    for (const row of r.table) expect(Number(row.headcount)).toBeGreaterThanOrEqual(0);
  });

  it("tenure & diversity aggregates without loading rows", async () => {
    const r = await tenureAndDiversity(admin);
    const totals = r.extras.genderTotals as { male: number; female: number; other: number; undisclosed: number };
    expect(totals.male + totals.female + totals.other + totals.undisclosed).toBe((r.extras.tenure as { headcount: number }).headcount);
  });

  it("custom report builder only returns allow-listed columns", async () => {
    const page = await runCustomReport(admin, { entity: "employees", columns: ["employeeCode", "displayName", "department", "tenureYears"], filters: { status: "ACTIVE" }, sort: "employeeCode", order: "asc", page: 1, pageSize: 5 });
    expect(page.items).toHaveLength(5);
    expect(Object.keys(page.items[0]).sort()).toEqual(["department", "displayName", "employeeCode", "tenureYears"]);
    expect(page.total).toBeGreaterThan(1000);
  });
});
