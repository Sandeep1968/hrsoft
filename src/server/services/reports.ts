import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { isoDate, monthRange, todayUtc } from "@/lib/dates";
import { paginate, toPage, zDateOnly, zUuid } from "@/lib/api";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { type Actor, authorize, can, visibleEmployeeIds } from "@/lib/rbac/authorize";

/**
 * All reports aggregate in SQL. Employee-based reports respect the actor's
 * `reports:view` scope (TEAM → only reports; ALL → whole organisation).
 */

const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

// ── CSV ────────────────────────────────────────────────────────────────

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  // Guard against spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0 && !columns) return "";
  const cols = columns ?? Object.keys(rows[0] ?? {});
  const lines = [cols.map(csvCell).join(",")];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

// ── Scope helper ───────────────────────────────────────────────────────

/** SQL fragment restricting `e` (Employee alias) to what the actor may report on. */
async function employeeScope(actor: Actor, alias = "e"): Promise<Prisma.Sql> {
  const ids = await visibleEmployeeIds(actor, "reports:view");
  if (ids === null) return Prisma.empty;
  const col = Prisma.raw(`"${alias}".id`);
  return Prisma.sql`AND ${col} = ANY(${ids.length ? ids : [EMPTY_UUID]}::uuid[])`;
}

// ── Catalogue ──────────────────────────────────────────────────────────

export const REPORT_CATALOGUE = [
  { name: "headcount", title: "Headcount", description: "Active headcount as of a date, grouped by department, location, type, gender or designation.", group: "People" },
  { name: "headcount-trend", title: "Headcount trend", description: "Joiners, exits and closing headcount per month.", group: "People" },
  { name: "attrition", title: "Attrition", description: "Exits over a period as a share of average headcount, by department, with reasons.", group: "People" },
  { name: "tenure-diversity", title: "Tenure & diversity", description: "Average tenure, gender ratio by department and age bands.", group: "People" },
  { name: "attendance-summary", title: "Attendance summary", description: "Attendance status mix and average work hours per department for a month.", group: "Time" },
  { name: "leave-utilisation", title: "Leave utilisation", description: "Accrued vs used days by leave type and the departments using the most leave.", group: "Time" },
  { name: "payroll-cost", title: "Payroll cost", description: "Monthly payroll totals for a year and department split of the latest finalised run.", group: "Finance" },
  { name: "expenses", title: "Expenses", description: "Expense claims by status, category and department for a period.", group: "Finance" },
] as const;
export type ReportName = (typeof REPORT_CATALOGUE)[number]["name"];

export const reportQuerySchemas = {
  headcount: z.object({ asOf: zDateOnly.optional(), groupBy: z.enum(["department", "location", "employmentType", "gender", "designation"]).default("department") }),
  "headcount-trend": z.object({ months: z.coerce.number().int().min(1).max(36).default(12) }),
  attrition: z.object({ from: zDateOnly.optional(), to: zDateOnly.optional() }),
  "tenure-diversity": z.object({}),
  "attendance-summary": z.object({ year: z.coerce.number().int().min(2000).max(2100).optional(), month: z.coerce.number().int().min(1).max(12).optional(), departmentId: zUuid.optional() }),
  "leave-utilisation": z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }),
  "payroll-cost": z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }),
  expenses: z.object({ from: zDateOnly.optional(), to: zDateOnly.optional() }),
} satisfies Record<ReportName, z.ZodTypeAny>;

export interface ReportResult {
  name: ReportName;
  title: string;
  params: Record<string, unknown>;
  generatedAt: string;
  /** Primary tabular output (also used for CSV). */
  table: Record<string, unknown>[];
  /** Column order for table/CSV. */
  columns: string[];
  /** Chart-ready series and any extra sections. */
  extras: Record<string, unknown>;
}

const GROUP_COLUMNS: Record<string, { select: Prisma.Sql; join: Prisma.Sql }> = {
  department: { select: Prisma.sql`COALESCE(d.name, 'Unassigned')`, join: Prisma.sql`LEFT JOIN "Department" d ON d.id = e."departmentId"` },
  location: { select: Prisma.sql`COALESCE(l.name, 'Unassigned')`, join: Prisma.sql`LEFT JOIN "Location" l ON l.id = e."locationId"` },
  employmentType: { select: Prisma.sql`e."employmentType"::text`, join: Prisma.empty },
  gender: { select: Prisma.sql`e.gender::text`, join: Prisma.empty },
  designation: { select: Prisma.sql`COALESCE(g.name, 'Unassigned')`, join: Prisma.sql`LEFT JOIN "Designation" g ON g.id = e."designationId"` },
};

// ── Reports ────────────────────────────────────────────────────────────

export async function headcountReport(actor: Actor, params: z.infer<(typeof reportQuerySchemas)["headcount"]>): Promise<ReportResult> {
  const scope = await employeeScope(actor);
  const asOf = params.asOf ?? todayUtc();
  const g = GROUP_COLUMNS[params.groupBy];
  const rows = await db.$queryRaw<{ label: string; headcount: number; fullTime: number; female: number }[]>`
    SELECT ${g.select} AS label, COUNT(*)::int AS headcount,
           COUNT(*) FILTER (WHERE e."employmentType" = 'FULL_TIME')::int AS "fullTime",
           COUNT(*) FILTER (WHERE e.gender = 'FEMALE')::int AS female
    FROM "Employee" e ${g.join}
    WHERE e."joiningDate" <= ${asOf}::date AND (e.status <> 'EXITED' OR e."exitDate" > ${asOf}::date) ${scope}
    GROUP BY 1 ORDER BY headcount DESC, label`;
  const total = rows.reduce((a, r) => a + r.headcount, 0);
  const table = rows.map((r) => ({ [params.groupBy]: r.label, headcount: r.headcount, sharePct: total ? Math.round((r.headcount / total) * 1000) / 10 : 0, fullTime: r.fullTime, female: r.female }));
  return { name: "headcount", title: "Headcount", params: { asOf: isoDate(asOf), groupBy: params.groupBy }, generatedAt: new Date().toISOString(), table, columns: [params.groupBy, "headcount", "sharePct", "fullTime", "female"], extras: { total, series: rows.map((r) => ({ label: r.label, value: r.headcount })) } };
}

export async function headcountTrend(actor: Actor, params: z.infer<(typeof reportQuerySchemas)["headcount-trend"]>): Promise<ReportResult> {
  const scope = await employeeScope(actor);
  const months = params.months;
  const rows = await db.$queryRaw<{ month: string; joins: number; exits: number; headcount: number }[]>`
    WITH m AS (
      SELECT date_trunc('month', CURRENT_DATE)::date - (interval '1 month' * s) AS start
      FROM generate_series(${months - 1}, 0, -1) s
    )
    SELECT to_char(m.start, 'YYYY-MM') AS month,
           (SELECT COUNT(*) FROM "Employee" e WHERE e."joiningDate" >= m.start AND e."joiningDate" < (m.start + interval '1 month') ${scope})::int AS joins,
           (SELECT COUNT(*) FROM "Employee" e WHERE e."exitDate" >= m.start AND e."exitDate" < (m.start + interval '1 month') ${scope})::int AS exits,
           (SELECT COUNT(*) FROM "Employee" e WHERE e."joiningDate" < (m.start + interval '1 month') AND (e."exitDate" IS NULL OR e."exitDate" >= (m.start + interval '1 month')) ${scope})::int AS headcount
    FROM m ORDER BY m.start`;
  return { name: "headcount-trend", title: "Headcount trend", params: { months }, generatedAt: new Date().toISOString(), table: rows, columns: ["month", "joins", "exits", "headcount"], extras: { series: rows } };
}

export async function attritionReport(actor: Actor, params: z.infer<(typeof reportQuerySchemas)["attrition"]>): Promise<ReportResult> {
  const scope = await employeeScope(actor);
  const to = params.to ?? todayUtc();
  const from = params.from ?? new Date(Date.UTC(to.getUTCFullYear() - 1, to.getUTCMonth(), to.getUTCDate() + 1));
  if (to.getTime() < from.getTime()) throw new ValidationError("`to` must be after `from`");
  const [byDept, reasons, totals] = await Promise.all([
    db.$queryRaw<{ department: string; exits: number; headStart: number; headEnd: number }[]>`
      SELECT COALESCE(d.name, 'Unassigned') AS department,
             COUNT(*) FILTER (WHERE e."exitDate" BETWEEN ${from}::date AND ${to}::date)::int AS exits,
             COUNT(*) FILTER (WHERE e."joiningDate" <= ${from}::date AND (e."exitDate" IS NULL OR e."exitDate" > ${from}::date))::int AS "headStart",
             COUNT(*) FILTER (WHERE e."joiningDate" <= ${to}::date AND (e."exitDate" IS NULL OR e."exitDate" > ${to}::date))::int AS "headEnd"
      FROM "Employee" e LEFT JOIN "Department" d ON d.id = e."departmentId"
      WHERE TRUE ${scope}
      GROUP BY 1 ORDER BY exits DESC, department`,
    db.$queryRaw<{ reason: string; count: number }[]>`
      SELECT COALESCE(NULLIF(TRIM(e."exitReason"), ''), 'Not recorded') AS reason, COUNT(*)::int AS count
      FROM "Employee" e WHERE e."exitDate" BETWEEN ${from}::date AND ${to}::date ${scope}
      GROUP BY 1 ORDER BY count DESC LIMIT 15`,
    db.$queryRaw<{ exits: number; headStart: number; headEnd: number; avgTenureYears: number | null }[]>`
      SELECT COUNT(*) FILTER (WHERE e."exitDate" BETWEEN ${from}::date AND ${to}::date)::int AS exits,
             COUNT(*) FILTER (WHERE e."joiningDate" <= ${from}::date AND (e."exitDate" IS NULL OR e."exitDate" > ${from}::date))::int AS "headStart",
             COUNT(*) FILTER (WHERE e."joiningDate" <= ${to}::date AND (e."exitDate" IS NULL OR e."exitDate" > ${to}::date))::int AS "headEnd",
             AVG((e."exitDate" - e."joiningDate") / 365.25) FILTER (WHERE e."exitDate" BETWEEN ${from}::date AND ${to}::date)::float AS "avgTenureYears"
      FROM "Employee" e WHERE TRUE ${scope}`,
  ]);
  const rate = (exits: number, a: number, b: number) => {
    const avg = (a + b) / 2;
    return avg > 0 ? Math.round((exits / avg) * 1000) / 10 : 0;
  };
  const table = byDept.map((r) => ({ department: r.department, exits: r.exits, avgHeadcount: (r.headStart + r.headEnd) / 2, attritionPct: rate(r.exits, r.headStart, r.headEnd) }));
  const t = totals[0];
  return {
    name: "attrition",
    title: "Attrition",
    params: { from: isoDate(from), to: isoDate(to) },
    generatedAt: new Date().toISOString(),
    table,
    columns: ["department", "exits", "avgHeadcount", "attritionPct"],
    extras: { total: { exits: t?.exits ?? 0, avgHeadcount: t ? (t.headStart + t.headEnd) / 2 : 0, attritionPct: t ? rate(t.exits, t.headStart, t.headEnd) : 0, avgTenureYears: t?.avgTenureYears ? Math.round(t.avgTenureYears * 10) / 10 : null }, reasons },
  };
}

export async function attendanceSummaryReport(actor: Actor, params: z.infer<(typeof reportQuerySchemas)["attendance-summary"]>): Promise<ReportResult> {
  const scope = await employeeScope(actor);
  const today = todayUtc();
  const year = params.year ?? today.getUTCFullYear();
  const month = params.month ?? today.getUTCMonth() + 1;
  const { start, end } = monthRange(year, month);
  const deptFilter = params.departmentId ? Prisma.sql`AND e."departmentId" = ${params.departmentId}::uuid` : Prisma.empty;
  const rows = await db.$queryRaw<{ department: string; status: string; count: number; avgWork: number | null; avgLate: number | null }[]>`
    SELECT COALESCE(d.name, 'Unassigned') AS department, a.status::text AS status, COUNT(*)::int AS count,
           AVG(a."workMinutes") FILTER (WHERE a.status IN ('PRESENT','WFH','HALF_DAY'))::float AS "avgWork",
           AVG(a."lateMinutes") FILTER (WHERE a.status IN ('PRESENT','HALF_DAY'))::float AS "avgLate"
    FROM "AttendanceRecord" a
      JOIN "Employee" e ON e.id = a."employeeId"
      LEFT JOIN "Department" d ON d.id = e."departmentId"
    WHERE a.date BETWEEN ${start}::date AND ${end}::date ${deptFilter} ${scope}
    GROUP BY 1, 2 ORDER BY 1`;
  const statuses = ["PRESENT", "WFH", "HALF_DAY", "ON_LEAVE", "ABSENT", "HOLIDAY", "WEEK_OFF"];
  const byDept = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const row = byDept.get(r.department) ?? { department: r.department, ...Object.fromEntries(statuses.map((s) => [s, 0])), workingRecords: 0, avgWorkHours: 0, avgLateMinutes: 0, _w: 0, _wl: 0, _lw: 0 };
    row[r.status] = r.count;
    if (r.avgWork !== null) {
      row._w = (row._w as number) + r.avgWork * r.count;
      row._wl = (row._wl as number) + r.count;
    }
    if (r.avgLate !== null) {
      row._lw = (row._lw as number) + r.avgLate * r.count;
    }
    byDept.set(r.department, row);
  }
  const table = [...byDept.values()].map((row) => {
    const w = row._wl as number;
    const present = (row.PRESENT as number) + (row.WFH as number) + (row.HALF_DAY as number);
    const working = present + (row.ON_LEAVE as number) + (row.ABSENT as number);
    return {
      department: row.department,
      ...Object.fromEntries(statuses.map((s) => [s, row[s]])),
      presencePct: working ? Math.round((present / working) * 1000) / 10 : 0,
      avgWorkHours: w ? Math.round(((row._w as number) / w / 60) * 10) / 10 : 0,
      avgLateMinutes: w ? Math.round((row._lw as number) / w) : 0,
    };
  });
  return { name: "attendance-summary", title: "Attendance summary", params: { year, month, departmentId: params.departmentId ?? null }, generatedAt: new Date().toISOString(), table, columns: ["department", ...statuses, "presencePct", "avgWorkHours", "avgLateMinutes"], extras: { statuses } };
}

export async function leaveUtilisationReport(actor: Actor, params: z.infer<(typeof reportQuerySchemas)["leave-utilisation"]>): Promise<ReportResult> {
  const scope = await employeeScope(actor);
  const year = params.year ?? todayUtc().getUTCFullYear();
  const [byType, byDept] = await Promise.all([
    db.$queryRaw<{ code: string; name: string; employees: number; entitled: number; used: number }[]>`
      SELECT lt.code, lt.name, COUNT(DISTINCT b."employeeId")::int AS employees,
             COALESCE(SUM(b.opening + b.accrued + b."carriedForward" + b.adjusted), 0)::float AS entitled,
             COALESCE(SUM(b.used), 0)::float AS used
      FROM "LeaveBalance" b JOIN "LeaveType" lt ON lt.id = b."leaveTypeId" JOIN "Employee" e ON e.id = b."employeeId"
      WHERE b.year = ${year} ${scope}
      GROUP BY lt.code, lt.name ORDER BY lt.code`,
    db.$queryRaw<{ department: string; employees: number; used: number; entitled: number }[]>`
      SELECT COALESCE(d.name, 'Unassigned') AS department, COUNT(DISTINCT b."employeeId")::int AS employees,
             COALESCE(SUM(b.used), 0)::float AS used,
             COALESCE(SUM(b.opening + b.accrued + b."carriedForward" + b.adjusted), 0)::float AS entitled
      FROM "LeaveBalance" b JOIN "Employee" e ON e.id = b."employeeId" LEFT JOIN "Department" d ON d.id = e."departmentId"
      WHERE b.year = ${year} ${scope}
      GROUP BY 1 ORDER BY used DESC LIMIT 12`,
  ]);
  const table = byType.map((r) => ({ leaveType: `${r.name} (${r.code})`, employees: r.employees, entitledDays: r.entitled, usedDays: r.used, utilisationPct: r.entitled ? Math.round((r.used / r.entitled) * 1000) / 10 : 0, avgUsedPerEmployee: r.employees ? Math.round((r.used / r.employees) * 10) / 10 : 0 }));
  return { name: "leave-utilisation", title: "Leave utilisation", params: { year }, generatedAt: new Date().toISOString(), table, columns: ["leaveType", "employees", "entitledDays", "usedDays", "utilisationPct", "avgUsedPerEmployee"], extras: { topDepartments: byDept.map((d) => ({ ...d, avgUsed: d.employees ? Math.round((d.used / d.employees) * 10) / 10 : 0 })) } };
}

export async function payrollCostReport(actor: Actor, params: z.infer<(typeof reportQuerySchemas)["payroll-cost"]>): Promise<ReportResult> {
  await authorize(actor, "reports:view", { minScope: "ALL" });
  if (!can(actor, "payroll:read", "ALL") && !can(actor, "payroll:run")) throw new ForbiddenError("Payroll cost requires payroll:read at ALL scope");
  const year = params.year ?? todayUtc().getUTCFullYear();
  const runs = await db.payrollRun.findMany({ where: { year }, orderBy: [{ month: "asc" }], select: { id: true, month: true, status: true, employeeCount: true, totalGross: true, totalDeductions: true, totalNet: true, totalEmployerCost: true, legalEntity: { select: { name: true } } } });
  const byMonth = new Map<number, { month: number; runs: number; employees: number; gross: number; deductions: number; net: number; employerCost: number; statuses: string[] }>();
  for (const r of runs) {
    const m = byMonth.get(r.month) ?? { month: r.month, runs: 0, employees: 0, gross: 0, deductions: 0, net: 0, employerCost: 0, statuses: [] };
    m.runs += 1;
    m.employees += r.employeeCount;
    m.gross += Number(r.totalGross);
    m.deductions += Number(r.totalDeductions);
    m.net += Number(r.totalNet);
    m.employerCost += Number(r.totalEmployerCost);
    m.statuses.push(r.status);
    byMonth.set(r.month, m);
  }
  const table = [...byMonth.values()].map((m) => ({ month: `${year}-${String(m.month).padStart(2, "0")}`, runs: m.runs, employees: m.employees, gross: m.gross, deductions: m.deductions, net: m.net, employerCost: m.employerCost, status: [...new Set(m.statuses)].join("/") }));
  const latest = await db.payrollRun.findFirst({ where: { status: { in: ["FINALIZED", "PAID"] } }, orderBy: [{ year: "desc" }, { month: "desc" }], select: { id: true, month: true, year: true, status: true } });
  const byDept = latest
    ? await db.$queryRaw<{ department: string; employees: number; gross: number; net: number; employerCost: number; pf: number; tds: number }[]>`
        SELECT COALESCE(d.name, 'Unassigned') AS department, COUNT(*)::int AS employees,
               SUM(p.gross)::float AS gross, SUM(p."netPay")::float AS net, SUM(p."employerCost")::float AS "employerCost",
               SUM(p."pfEmployee" + p."pfEmployer")::float AS pf, SUM(p.tds)::float AS tds
        FROM "Payslip" p JOIN "Employee" e ON e.id = p."employeeId" LEFT JOIN "Department" d ON d.id = e."departmentId"
        WHERE p."runId" = ${latest.id}::uuid
        GROUP BY 1 ORDER BY "employerCost" DESC`
    : [];
  return { name: "payroll-cost", title: "Payroll cost", params: { year }, generatedAt: new Date().toISOString(), table, columns: ["month", "runs", "employees", "gross", "deductions", "net", "employerCost", "status"], extras: { latestRun: latest, byDepartment: byDept, totals: { gross: table.reduce((a, b) => a + b.gross, 0), net: table.reduce((a, b) => a + b.net, 0), employerCost: table.reduce((a, b) => a + b.employerCost, 0) } } };
}

export async function expenseReport(actor: Actor, params: z.infer<(typeof reportQuerySchemas)["expenses"]>): Promise<ReportResult> {
  const scope = await employeeScope(actor);
  const to = params.to ?? todayUtc();
  const from = params.from ?? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 2, 1));
  if (to.getTime() < from.getTime()) throw new ValidationError("`to` must be after `from`");
  const toExclusive = new Date(to.getTime() + 86_400_000);
  const [byStatus, byCategory, byDept] = await Promise.all([
    db.$queryRaw<{ status: string; claims: number; amount: number }[]>`
      SELECT c.status::text AS status, COUNT(*)::int AS claims, COALESCE(SUM(c."totalAmount"), 0)::float AS amount
      FROM "ExpenseClaim" c JOIN "Employee" e ON e.id = c."employeeId"
      WHERE c."createdAt" >= ${from} AND c."createdAt" < ${toExclusive} ${scope}
      GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<{ category: string; items: number; amount: number }[]>`
      SELECT cat.name AS category, COUNT(*)::int AS items, COALESCE(SUM(i.amount), 0)::float AS amount
      FROM "ExpenseItem" i JOIN "ExpenseCategory" cat ON cat.id = i."categoryId" JOIN "ExpenseClaim" c ON c.id = i."claimId" JOIN "Employee" e ON e.id = c."employeeId"
      WHERE c."createdAt" >= ${from} AND c."createdAt" < ${toExclusive} AND c.status <> 'DRAFT' ${scope}
      GROUP BY 1 ORDER BY amount DESC`,
    db.$queryRaw<{ department: string; claims: number; amount: number; reimbursed: number }[]>`
      SELECT COALESCE(d.name, 'Unassigned') AS department, COUNT(*)::int AS claims, COALESCE(SUM(c."totalAmount"), 0)::float AS amount,
             COALESCE(SUM(c."totalAmount") FILTER (WHERE c.status = 'REIMBURSED'), 0)::float AS reimbursed
      FROM "ExpenseClaim" c JOIN "Employee" e ON e.id = c."employeeId" LEFT JOIN "Department" d ON d.id = e."departmentId"
      WHERE c."createdAt" >= ${from} AND c."createdAt" < ${toExclusive} AND c.status <> 'DRAFT' ${scope}
      GROUP BY 1 ORDER BY amount DESC LIMIT 15`,
  ]);
  return { name: "expenses", title: "Expenses", params: { from: isoDate(from), to: isoDate(to) }, generatedAt: new Date().toISOString(), table: byCategory, columns: ["category", "items", "amount"], extras: { byStatus, byDepartment: byDept, totals: { claims: byStatus.reduce((a, b) => a + b.claims, 0), amount: byStatus.reduce((a, b) => a + b.amount, 0) } } };
}

export async function tenureAndDiversity(actor: Actor): Promise<ReportResult> {
  const scope = await employeeScope(actor);
  const [tenure, genderByDept, ageBands, tenureBands] = await Promise.all([
    db.$queryRaw<{ avgTenureYears: number | null; medianTenureYears: number | null; headcount: number }[]>`
      SELECT AVG((CURRENT_DATE - e."joiningDate") / 365.25)::float AS "avgTenureYears",
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (CURRENT_DATE - e."joiningDate") / 365.25)::float AS "medianTenureYears",
             COUNT(*)::int AS headcount
      FROM "Employee" e WHERE e.status <> 'EXITED' ${scope}`,
    db.$queryRaw<{ department: string; male: number; female: number; other: number; undisclosed: number; total: number }[]>`
      SELECT COALESCE(d.name, 'Unassigned') AS department,
             COUNT(*) FILTER (WHERE e.gender = 'MALE')::int AS male,
             COUNT(*) FILTER (WHERE e.gender = 'FEMALE')::int AS female,
             COUNT(*) FILTER (WHERE e.gender = 'OTHER')::int AS other,
             COUNT(*) FILTER (WHERE e.gender = 'UNDISCLOSED')::int AS undisclosed,
             COUNT(*)::int AS total
      FROM "Employee" e LEFT JOIN "Department" d ON d.id = e."departmentId"
      WHERE e.status <> 'EXITED' ${scope}
      GROUP BY 1 ORDER BY total DESC`,
    db.$queryRaw<{ band: string; count: number }[]>`
      SELECT CASE
               WHEN e."dateOfBirth" IS NULL THEN 'Unknown'
               WHEN age(e."dateOfBirth") < interval '25 years' THEN 'Under 25'
               WHEN age(e."dateOfBirth") < interval '35 years' THEN '25–34'
               WHEN age(e."dateOfBirth") < interval '45 years' THEN '35–44'
               WHEN age(e."dateOfBirth") < interval '55 years' THEN '45–54'
               ELSE '55+' END AS band, COUNT(*)::int AS count
      FROM "Employee" e WHERE e.status <> 'EXITED' ${scope}
      GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<{ band: string; count: number }[]>`
      SELECT CASE
               WHEN CURRENT_DATE - e."joiningDate" < 365 THEN '< 1 yr'
               WHEN CURRENT_DATE - e."joiningDate" < 365 * 3 THEN '1–3 yrs'
               WHEN CURRENT_DATE - e."joiningDate" < 365 * 5 THEN '3–5 yrs'
               WHEN CURRENT_DATE - e."joiningDate" < 365 * 10 THEN '5–10 yrs'
               ELSE '10+ yrs' END AS band, COUNT(*)::int AS count
      FROM "Employee" e WHERE e.status <> 'EXITED' ${scope}
      GROUP BY 1 ORDER BY MIN(CURRENT_DATE - e."joiningDate")`,
  ]);
  const t = tenure[0];
  const table = genderByDept.map((r) => ({ ...r, femalePct: r.total ? Math.round((r.female / r.total) * 1000) / 10 : 0 }));
  return {
    name: "tenure-diversity",
    title: "Tenure & diversity",
    params: {},
    generatedAt: new Date().toISOString(),
    table,
    columns: ["department", "total", "male", "female", "other", "undisclosed", "femalePct"],
    extras: { tenure: { avgYears: t?.avgTenureYears ? Math.round(t.avgTenureYears * 10) / 10 : 0, medianYears: t?.medianTenureYears ? Math.round(t.medianTenureYears * 10) / 10 : 0, headcount: t?.headcount ?? 0 }, ageBands, tenureBands, genderTotals: table.reduce((acc, r) => ({ male: acc.male + r.male, female: acc.female + r.female, other: acc.other + r.other, undisclosed: acc.undisclosed + r.undisclosed }), { male: 0, female: 0, other: 0, undisclosed: 0 }) },
  };
}

/** Dispatches by report name with validated query params. */
export async function runReport(actor: Actor, name: string, query: Record<string, unknown>): Promise<ReportResult> {
  await authorize(actor, "reports:view");
  const entry = REPORT_CATALOGUE.find((r) => r.name === name);
  if (!entry) throw new NotFoundError("Report");
  switch (entry.name) {
    case "headcount":
      return headcountReport(actor, reportQuerySchemas.headcount.parse(query));
    case "headcount-trend":
      return headcountTrend(actor, reportQuerySchemas["headcount-trend"].parse(query));
    case "attrition":
      return attritionReport(actor, reportQuerySchemas.attrition.parse(query));
    case "tenure-diversity":
      return tenureAndDiversity(actor);
    case "attendance-summary":
      return attendanceSummaryReport(actor, reportQuerySchemas["attendance-summary"].parse(query));
    case "leave-utilisation":
      return leaveUtilisationReport(actor, reportQuerySchemas["leave-utilisation"].parse(query));
    case "payroll-cost":
      return payrollCostReport(actor, reportQuerySchemas["payroll-cost"].parse(query));
    case "expenses":
      return expenseReport(actor, reportQuerySchemas.expenses.parse(query));
  }
}

export function reportToCsv(r: ReportResult): string {
  return toCsv(r.table, r.columns);
}

// ── Custom report builder (employees) ──────────────────────────────────

/** Allow-listed employee columns → Prisma select + row extractor. Never user-supplied SQL. */
export const CUSTOM_COLUMNS = {
  employeeCode: { label: "Employee code", group: "Identity" },
  displayName: { label: "Name", group: "Identity" },
  workEmail: { label: "Work email", group: "Identity" },
  phone: { label: "Phone", group: "Identity" },
  gender: { label: "Gender", group: "Identity" },
  dateOfBirth: { label: "Date of birth", group: "Identity" },
  department: { label: "Department", group: "Job" },
  designation: { label: "Designation", group: "Job" },
  location: { label: "Location", group: "Job" },
  legalEntity: { label: "Legal entity", group: "Job" },
  manager: { label: "Manager", group: "Job" },
  employmentType: { label: "Employment type", group: "Job" },
  status: { label: "Status", group: "Job" },
  joiningDate: { label: "Joining date", group: "Dates" },
  confirmationDate: { label: "Confirmation date", group: "Dates" },
  exitDate: { label: "Exit date", group: "Dates" },
  tenureYears: { label: "Tenure (years)", group: "Dates" },
  noticePeriodDays: { label: "Notice period (days)", group: "Job" },
} as const;
export type CustomColumn = keyof typeof CUSTOM_COLUMNS;
const CUSTOM_COLUMN_KEYS = Object.keys(CUSTOM_COLUMNS) as [CustomColumn, ...CustomColumn[]];

export const customReportSchema = z.object({
  entity: z.literal("employees").default("employees"),
  columns: z.array(z.enum(CUSTOM_COLUMN_KEYS)).min(1).max(20),
  filters: z
    .object({
      departmentId: zUuid.optional(),
      locationId: zUuid.optional(),
      status: z.enum(["ONBOARDING", "ACTIVE", "ON_NOTICE", "EXITED"]).optional(),
      employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN", "CONSULTANT"]).optional(),
      gender: z.enum(["MALE", "FEMALE", "OTHER", "UNDISCLOSED"]).optional(),
      joinedFrom: zDateOnly.optional(),
      joinedTo: zDateOnly.optional(),
      q: z.string().trim().max(100).optional(),
    })
    .default({}),
  sort: z.enum(["employeeCode", "displayName", "joiningDate"]).default("employeeCode"),
  order: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type CustomReportInput = z.infer<typeof customReportSchema>;

const CSV_MAX_ROWS = 5000;

export async function runCustomReport(actor: Actor, input: CustomReportInput, opts: { forExport?: boolean } = {}) {
  const ids = await visibleEmployeeIds(actor, "reports:view");
  if (!can(actor, "employees:read")) throw new ForbiddenError("Custom reports require employees:read");
  const f = input.filters;
  const where: Prisma.EmployeeWhereInput = {
    AND: [
      ids === null ? {} : { id: { in: ids } },
      f.departmentId ? { departmentId: f.departmentId } : {},
      f.locationId ? { locationId: f.locationId } : {},
      f.status ? { status: f.status } : {},
      f.employmentType ? { employmentType: f.employmentType } : {},
      f.gender ? { gender: f.gender } : {},
      f.joinedFrom ? { joiningDate: { gte: f.joinedFrom } } : {},
      f.joinedTo ? { joiningDate: { lte: f.joinedTo } } : {},
      f.q ? { OR: [{ displayName: { contains: f.q, mode: "insensitive" } }, { employeeCode: { contains: f.q, mode: "insensitive" } }, { workEmail: { contains: f.q, mode: "insensitive" } }] } : {},
    ],
  };
  const cols = new Set<CustomColumn>(input.columns);
  const select: Prisma.EmployeeSelect = {
    id: true,
    employeeCode: cols.has("employeeCode"),
    displayName: cols.has("displayName"),
    workEmail: cols.has("workEmail"),
    phone: cols.has("phone"),
    gender: cols.has("gender"),
    dateOfBirth: cols.has("dateOfBirth"),
    employmentType: cols.has("employmentType"),
    status: cols.has("status"),
    joiningDate: cols.has("joiningDate") || cols.has("tenureYears"),
    confirmationDate: cols.has("confirmationDate"),
    exitDate: cols.has("exitDate") || cols.has("tenureYears"),
    noticePeriodDays: cols.has("noticePeriodDays"),
    department: cols.has("department") ? { select: { name: true } } : false,
    designation: cols.has("designation") ? { select: { name: true } } : false,
    location: cols.has("location") ? { select: { name: true } } : false,
    legalEntity: cols.has("legalEntity") ? { select: { name: true } } : false,
    manager: cols.has("manager") ? { select: { displayName: true } } : false,
  };
  const pageOpts = opts.forExport ? { skip: 0, take: CSV_MAX_ROWS } : paginate(input);
  const [rows, total] = await Promise.all([db.employee.findMany({ where, select, orderBy: { [input.sort]: input.order }, ...pageOpts }), db.employee.count({ where })]);
  const today = todayUtc().getTime();
  const flat = rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const c of input.columns) {
      switch (c) {
        case "department": out[c] = r.department?.name ?? null; break;
        case "designation": out[c] = r.designation?.name ?? null; break;
        case "location": out[c] = r.location?.name ?? null; break;
        case "legalEntity": out[c] = r.legalEntity?.name ?? null; break;
        case "manager": out[c] = r.manager?.displayName ?? null; break;
        case "dateOfBirth": case "joiningDate": case "confirmationDate": case "exitDate": {
          const v = r[c];
          out[c] = v ? isoDate(v) : null;
          break;
        }
        case "tenureYears": {
          const end = r.exitDate ? r.exitDate.getTime() : today;
          out[c] = r.joiningDate ? Math.round(((end - r.joiningDate.getTime()) / 31_557_600_000) * 10) / 10 : null;
          break;
        }
        default: out[c] = r[c];
      }
    }
    return out;
  });
  return { ...toPage(flat, total, opts.forExport ? { page: 1, pageSize: CSV_MAX_ROWS } : input), columns: input.columns, truncated: opts.forExport && total > CSV_MAX_ROWS };
}

export async function reportLookups(actor: Actor) {
  await authorize(actor, "reports:view");
  const [departments, locations] = await Promise.all([db.department.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }), db.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } })]);
  return { departments, locations };
}
