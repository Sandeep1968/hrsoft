/**
 * HRsoft payroll engine — pure functions, no DB access.
 *
 * Everything here is deterministic and unit-tested (engine.test.ts). The
 * service layer (services/payroll.ts) loads data and feeds it in.
 *
 * Money convention: structure amounts are kept to 2 decimals; payslip line
 * amounts are rounded to whole rupees so that `netPay === gross − deductions`
 * holds exactly and matches how Indian payslips / ECR files are published.
 */

export type CalcType = "FIXED" | "PERCENT_OF_BASIC" | "PERCENT_OF_GROSS" | "PERCENT_OF_CTC" | "BALANCE";
export type ComponentType = "EARNING" | "DEDUCTION" | "EMPLOYER_CONTRIBUTION" | "REIMBURSEMENT";
export type Regime = "NEW" | "OLD";

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const roundRupee = (n: number) => Math.round(n + Number.EPSILON);

// ───────────────────────────── Salary structure ─────────────────────────────

export interface StructureLine {
  code: string;
  calcType: CalcType;
  value: number;
  type: ComponentType;
}

/**
 * Expand an annual CTC into monthly component amounts following the lines in
 * order. PERCENT_OF_CTC is of the monthly CTC, PERCENT_OF_BASIC of the BASIC
 * line, PERCENT_OF_GROSS of the earnings computed so far. BALANCE lines are
 * filled last with `monthlyCtc − other earnings` (floored at 0). Employer
 * contributions are NOT deducted from the balance.
 */
export function computeMonthlyStructure(annualCtc: number, lines: StructureLine[]): Record<string, number> {
  const monthlyCtc = annualCtc / 12;
  const out: Record<string, number> = {};
  let earningsSoFar = 0;
  const isEarning = (l: StructureLine) => l.type === "EARNING" || l.type === "REIMBURSEMENT";
  for (const l of lines) {
    if (l.calcType === "BALANCE") continue;
    let amt = 0;
    switch (l.calcType) {
      case "FIXED":
        amt = l.value;
        break;
      case "PERCENT_OF_CTC":
        amt = (monthlyCtc * l.value) / 100;
        break;
      case "PERCENT_OF_BASIC":
        amt = ((out.BASIC ?? 0) * l.value) / 100;
        break;
      case "PERCENT_OF_GROSS":
        amt = (earningsSoFar * l.value) / 100;
        break;
    }
    amt = round2(Math.max(0, amt));
    out[l.code] = amt;
    if (isEarning(l)) earningsSoFar += amt;
  }
  let balanceGiven = false;
  for (const l of lines) {
    if (l.calcType !== "BALANCE") continue;
    if (balanceGiven || !isEarning(l)) {
      out[l.code] = 0;
      continue;
    }
    out[l.code] = round2(Math.max(0, monthlyCtc - earningsSoFar));
    balanceGiven = true;
  }
  return out;
}

// ───────────────────────────── Professional tax ─────────────────────────────

export interface PtSlab {
  /** Upper bound of monthly gross (inclusive); null = no upper bound. */
  upTo: number | null;
  amount: number;
  /** Calendar-month specific override, e.g. Maharashtra charges 300 in February. */
  amountByMonth?: Record<number, number>;
}

/** Table-driven professional-tax slabs by state code. Edit here when a state revises its slabs. */
export const PT_SLABS: Record<string, PtSlab[]> = {
  TS: [
    { upTo: 15000, amount: 0 },
    { upTo: 20000, amount: 150 },
    { upTo: null, amount: 200 },
  ],
  AP: [
    { upTo: 15000, amount: 0 },
    { upTo: 20000, amount: 150 },
    { upTo: null, amount: 200 },
  ],
  KA: [
    { upTo: 25000, amount: 0 },
    { upTo: null, amount: 200 },
  ],
  MH: [
    { upTo: 7500, amount: 0 },
    { upTo: 10000, amount: 175 },
    { upTo: null, amount: 200, amountByMonth: { 2: 300 } },
  ],
  WB: [
    { upTo: 10000, amount: 0 },
    { upTo: 15000, amount: 110 },
    { upTo: 25000, amount: 130 },
    { upTo: 40000, amount: 150 },
    { upTo: null, amount: 200 },
  ],
  GJ: [
    { upTo: 12000, amount: 0 },
    { upTo: null, amount: 200 },
  ],
  // Tamil Nadu levies half-yearly; approximated as a flat monthly amount.
  TN: [
    { upTo: 21000, amount: 0 },
    { upTo: null, amount: 208 },
  ],
};

const PT_STATE_ALIASES: Record<string, string> = {
  TELANGANA: "TS",
  "ANDHRA PRADESH": "AP",
  KARNATAKA: "KA",
  MAHARASHTRA: "MH",
  "WEST BENGAL": "WB",
  GUJARAT: "GJ",
  "TAMIL NADU": "TN",
};

export function normalizePtState(state: string | null | undefined): string | null {
  if (!state) return null;
  const s = state.trim().toUpperCase();
  return PT_STATE_ALIASES[s] ?? s;
}

export function computeProfessionalTax(state: string | null | undefined, monthlyGross: number, month: number): number {
  const code = normalizePtState(state);
  if (!code) return 0;
  const slabs = PT_SLABS[code];
  if (!slabs) return 0;
  for (const s of slabs) {
    if (s.upTo === null || monthlyGross <= s.upTo) return s.amountByMonth?.[month] ?? s.amount;
  }
  return 0;
}

// ───────────────────────────── PF / ESI ─────────────────────────────

export interface PfInput {
  basic: number;
  pfWageCeiling?: number;
  employeePct?: number;
  employerPct?: number;
  applicable: boolean;
}

export const EPS_PCT = 8.33;
export const EPS_MONTHLY_CAP = 1250;

/** PF on min(basic, ceiling). Employer share is split into EPS (8.33%, capped) and EPF (remainder). Whole rupees. */
export function computePf(i: PfInput): { wage: number; employee: number; employer: number; eps: number; epf: number } {
  if (!i.applicable || i.basic <= 0) return { wage: 0, employee: 0, employer: 0, eps: 0, epf: 0 };
  const ceiling = i.pfWageCeiling ?? 15000;
  const wage = Math.min(i.basic, ceiling);
  const employee = roundRupee((wage * (i.employeePct ?? 12)) / 100);
  const employer = roundRupee((wage * (i.employerPct ?? 12)) / 100);
  const eps = Math.min(EPS_MONTHLY_CAP, roundRupee((wage * EPS_PCT) / 100), employer);
  return { wage, employee, employer, eps, epf: employer - eps };
}

export interface EsiInput {
  gross: number;
  ceiling?: number;
  employeePct?: number;
  employerPct?: number;
  applicable: boolean;
}

/** ESI applies only while gross ≤ ceiling. Contributions are rounded UP to the next rupee (ESIC rule). */
export function computeEsi(i: EsiInput): { employee: number; employer: number } {
  const ceiling = i.ceiling ?? 21000;
  if (!i.applicable || i.gross <= 0 || i.gross > ceiling) return { employee: 0, employer: 0 };
  return {
    employee: Math.ceil((i.gross * (i.employeePct ?? 0.75)) / 100 - 1e-9),
    employer: Math.ceil((i.gross * (i.employerPct ?? 3.25)) / 100 - 1e-9),
  };
}

// ───────────────────────────── Income tax ─────────────────────────────

export interface TaxSlab {
  /** Upper bound of taxable income (exclusive of next slab); null = no upper bound. */
  upTo: number | null;
  rate: number;
}

export interface RegimeRules {
  standardDeduction: number;
  slabs: TaxSlab[];
  /** Basic exemption overrides by age bracket (OLD regime senior citizens). */
  seniorSlabs?: { minAge: number; slabs: TaxSlab[] }[];
  /** 87A: tax is nil when taxable income ≤ this; marginal relief applies just above it (NEW regime). */
  rebateThreshold: number;
  rebateMax: number | null;
  rebateMarginalRelief: boolean;
  /** Chapter VI-A caps (OLD regime). `null` = not allowed. */
  deductionCaps: Partial<Record<DeclarationKey, number | null>>;
  /** Professional tax (16(iii)) deductible? */
  allowProfessionalTax: boolean;
}

export interface TaxRules {
  fy: string;
  regimes: Record<Regime, RegimeRules>;
  surcharge: { above: number; rate: number }[];
  cessRate: number;
}

export type DeclarationKey = "80C" | "80D" | "80CCD1B" | "80CCD2" | "HRA_EXEMPT" | "24B" | "80G" | "80TTA";

/**
 * Tax rules keyed by financial year. FY 2026-27 uses the FY 2025-26 (Finance
 * Act 2025) numbers as the best-known baseline — edit / add a new key when
 * the Budget changes slabs.
 */
export const TAX_RULES: Record<string, TaxRules> = {
  "2026-27": {
    fy: "2026-27",
    regimes: {
      NEW: {
        standardDeduction: 75_000,
        slabs: [
          { upTo: 400_000, rate: 0 },
          { upTo: 800_000, rate: 5 },
          { upTo: 1_200_000, rate: 10 },
          { upTo: 1_600_000, rate: 15 },
          { upTo: 2_000_000, rate: 20 },
          { upTo: 2_400_000, rate: 25 },
          { upTo: null, rate: 30 },
        ],
        rebateThreshold: 1_200_000,
        rebateMax: null,
        rebateMarginalRelief: true,
        deductionCaps: { "80CCD2": Infinity, "80C": null, "80D": null, "80CCD1B": null, HRA_EXEMPT: null, "24B": null, "80G": null, "80TTA": null },
        allowProfessionalTax: false,
      },
      OLD: {
        standardDeduction: 50_000,
        slabs: [
          { upTo: 250_000, rate: 0 },
          { upTo: 500_000, rate: 5 },
          { upTo: 1_000_000, rate: 20 },
          { upTo: null, rate: 30 },
        ],
        seniorSlabs: [
          { minAge: 80, slabs: [{ upTo: 500_000, rate: 0 }, { upTo: 1_000_000, rate: 20 }, { upTo: null, rate: 30 }] },
          { minAge: 60, slabs: [{ upTo: 300_000, rate: 0 }, { upTo: 500_000, rate: 5 }, { upTo: 1_000_000, rate: 20 }, { upTo: null, rate: 30 }] },
        ],
        rebateThreshold: 500_000,
        rebateMax: 12_500,
        rebateMarginalRelief: false,
        deductionCaps: { "80C": 150_000, "80D": 25_000, "80CCD1B": 50_000, "80CCD2": Infinity, HRA_EXEMPT: Infinity, "24B": 200_000, "80G": Infinity, "80TTA": 10_000 },
        allowProfessionalTax: true,
      },
    },
    surcharge: [
      { above: 5_000_000, rate: 10 },
      { above: 10_000_000, rate: 15 },
      { above: 20_000_000, rate: 25 },
    ],
    cessRate: 4,
  },
};
TAX_RULES["2025-26"] = { ...TAX_RULES["2026-27"], fy: "2025-26" };

export const DEFAULT_FY = "2026-27";

export function rulesFor(fy?: string): TaxRules {
  return TAX_RULES[fy ?? DEFAULT_FY] ?? TAX_RULES[DEFAULT_FY];
}

export function slabTax(taxable: number, slabs: TaxSlab[]): number {
  let tax = 0;
  let lower = 0;
  for (const s of slabs) {
    const upper = s.upTo ?? Infinity;
    if (taxable > lower) tax += (Math.min(taxable, upper) - lower) * (s.rate / 100);
    lower = upper;
    if (taxable <= upper) break;
  }
  return tax;
}

export interface AnnualTaxInput {
  regime: Regime;
  /** Gross taxable salary for the year (earnings that are taxable, before standard deduction). */
  annualTaxableSalary: number;
  declarations?: Partial<Record<DeclarationKey, number>>;
  age?: number;
  /** Professional tax paid in the year (deductible u/s 16(iii) under OLD regime). */
  annualProfessionalTax?: number;
  fy?: string;
}

export interface AnnualTaxResult {
  regime: Regime;
  grossSalary: number;
  standardDeduction: number;
  deductions: number;
  taxableIncome: number;
  slabTax: number;
  rebate: number;
  taxBeforeCess: number;
  surcharge: number;
  cess: number;
  totalTax: number;
  monthlyTds: number;
}

/** Annual income-tax liability for a salaried employee under the chosen regime. */
export function computeAnnualTax(i: AnnualTaxInput): AnnualTaxResult {
  const rules = rulesFor(i.fy);
  const r = rules.regimes[i.regime];
  const decl = i.declarations ?? {};
  let deductions = 0;
  for (const [k, v] of Object.entries(decl) as [DeclarationKey, number | undefined][]) {
    if (!v || v <= 0) continue;
    const cap = r.deductionCaps[k];
    if (cap === null || cap === undefined) continue;
    let effectiveCap = cap;
    if (k === "80D" && (i.age ?? 0) >= 60 && cap !== Infinity) effectiveCap = cap * 2;
    deductions += Math.min(v, effectiveCap);
  }
  if (r.allowProfessionalTax && i.annualProfessionalTax) deductions += Math.min(i.annualProfessionalTax, 2500);

  const gross = Math.max(0, i.annualTaxableSalary);
  const taxableRaw = Math.max(0, gross - r.standardDeduction - deductions);
  // Income is computed to the nearest ten rupees (s.288A) — keep whole rupees.
  const taxable = Math.floor(taxableRaw);

  let slabs = r.slabs;
  if (r.seniorSlabs && i.age !== undefined) {
    const match = r.seniorSlabs.find((s) => (i.age ?? 0) >= s.minAge);
    if (match) slabs = match.slabs;
  }
  const basicTax = slabTax(taxable, slabs);

  let rebate = 0;
  if (taxable <= r.rebateThreshold) {
    rebate = r.rebateMax === null ? basicTax : Math.min(basicTax, r.rebateMax);
  } else if (r.rebateMarginalRelief) {
    // Marginal relief: tax cannot exceed the income above the threshold.
    const excess = taxable - r.rebateThreshold;
    if (basicTax > excess) rebate = basicTax - excess;
  }
  const taxBeforeCess = Math.max(0, basicTax - rebate);

  // Surcharge with simple marginal relief.
  let surcharge = 0;
  const band = [...rules.surcharge].reverse().find((s) => taxable > s.above);
  if (band && taxBeforeCess > 0) {
    surcharge = (taxBeforeCess * band.rate) / 100;
    const thresholdTax = slabTax(band.above, slabs);
    const prevBand = rules.surcharge.filter((s) => s.above < band.above).pop();
    const thresholdSurcharge = prevBand ? (thresholdTax * prevBand.rate) / 100 : 0;
    const maxTotal = thresholdTax + thresholdSurcharge + (taxable - band.above);
    if (taxBeforeCess + surcharge > maxTotal) surcharge = Math.max(0, maxTotal - taxBeforeCess);
  }
  const cess = ((taxBeforeCess + surcharge) * rules.cessRate) / 100;
  const totalTax = roundRupee(taxBeforeCess + surcharge + cess);
  return {
    regime: i.regime,
    grossSalary: gross,
    standardDeduction: r.standardDeduction,
    deductions,
    taxableIncome: taxable,
    slabTax: roundRupee(basicTax),
    rebate: roundRupee(rebate),
    taxBeforeCess: roundRupee(taxBeforeCess),
    surcharge: roundRupee(surcharge),
    cess: roundRupee(cess),
    totalTax,
    monthlyTds: roundRupee(totalTax / 12),
  };
}

// ───────────────────────────── Monthly payslip ─────────────────────────────

export interface ComponentLike {
  code: string;
  name?: string;
  type: ComponentType;
  isTaxable: boolean;
  isProrated: boolean;
  isStatutory?: boolean;
  isPartOfCtc?: boolean;
  order?: number;
}

export interface AdjustmentLike {
  code: string;
  label: string;
  type: "EARNING" | "DEDUCTION";
  amount: number;
  isTaxable: boolean;
}

export interface StatutoryConfig {
  pfWageCeiling: number;
  pfEmployeePct: number;
  pfEmployerPct: number;
  esiWageCeiling: number;
  esiEmployeePct: number;
  esiEmployerPct: number;
  ptState: string | null;
}

export interface PayslipInput {
  /** Monthly structure amounts keyed by component code (EmployeeSalary.monthly). */
  monthly: Record<string, number>;
  components: ComponentLike[];
  daysInMonth: number;
  lopDays: number;
  /** Calendar month 1..12 (for PT month overrides). */
  month: number;
  statutory: StatutoryConfig;
  flags: { pfApplicable: boolean; esiApplicable: boolean; ptApplicable: boolean };
  adjustments: AdjustmentLike[];
  /** TDS already deducted in this FY (prior payslips). */
  annualTaxAlreadyPaid: number;
  /** Projected taxable salary for the FY (prior taxable earnings + this month's projection × months remaining). */
  projectedAnnualTaxable: number;
  regime: Regime;
  declarations: Partial<Record<DeclarationKey, number>>;
  /** 1 = April … 12 = March. */
  monthIndexInFY: number;
  /** Months left in the FY including this one (13 − monthIndexInFY). */
  monthsRemainingInFY: number;
  age?: number;
  fy?: string;
}

export interface PayslipResult {
  earnings: Record<string, number>;
  deductions: Record<string, number>;
  employerContributions: Record<string, number>;
  gross: number;
  taxableEarnings: number;
  totalDeductions: number;
  netPay: number;
  employerCost: number;
  pfEmployee: number;
  pfEmployer: number;
  esiEmployee: number;
  esiEmployer: number;
  professionalTax: number;
  tds: number;
  payableDays: number;
  lopDays: number;
  annualTax: AnnualTaxResult;
}

export const STATUTORY_CODES = { PF_EE: "PF_EE", ESI_EE: "ESI_EE", PT: "PT", TDS: "TDS", PF_ER: "PF_ER", ESI_ER: "ESI_ER" } as const;

/** Full monthly payslip computation. All line amounts are whole rupees. */
export function computePayslip(input: PayslipInput): PayslipResult {
  const byCode = new Map(input.components.map((c) => [c.code, c]));
  const daysInMonth = Math.max(1, input.daysInMonth);
  const lopDays = Math.min(daysInMonth, Math.max(0, input.lopDays));
  const payableDays = round2(daysInMonth - lopDays);
  const factor = payableDays / daysInMonth;

  const earnings: Record<string, number> = {};
  const deductions: Record<string, number> = {};
  const employer: Record<string, number> = {};
  let taxableEarnings = 0;

  // 1. Structure lines
  for (const [code, raw] of Object.entries(input.monthly)) {
    const amount = Number(raw) || 0;
    if (amount <= 0) continue;
    const c = byCode.get(code) ?? { code, type: "EARNING" as ComponentType, isTaxable: true, isProrated: true };
    if (c.type === "EARNING" || c.type === "REIMBURSEMENT") {
      const amt = roundRupee(c.isProrated ? amount * factor : amount);
      earnings[code] = (earnings[code] ?? 0) + amt;
      if (c.isTaxable) taxableEarnings += amt;
    } else if (c.type === "DEDUCTION") {
      if (c.isStatutory) continue; // statutory deductions are computed below
      deductions[code] = (deductions[code] ?? 0) + roundRupee(c.isProrated ? amount * factor : amount);
    } else if (c.type === "EMPLOYER_CONTRIBUTION") {
      if (c.isStatutory) continue;
      employer[code] = (employer[code] ?? 0) + roundRupee(amount);
    }
  }

  // 2. One-off adjustments
  for (const a of input.adjustments) {
    const amt = roundRupee(Number(a.amount) || 0);
    if (amt <= 0) continue;
    if (a.type === "EARNING") {
      earnings[a.code] = (earnings[a.code] ?? 0) + amt;
      if (a.isTaxable) taxableEarnings += amt;
    } else {
      deductions[a.code] = (deductions[a.code] ?? 0) + amt;
    }
  }

  const gross = Object.values(earnings).reduce((a, b) => a + b, 0);
  const basic = earnings.BASIC ?? 0;

  // 3. Statutory
  const pf = computePf({
    basic,
    pfWageCeiling: input.statutory.pfWageCeiling,
    employeePct: input.statutory.pfEmployeePct,
    employerPct: input.statutory.pfEmployerPct,
    applicable: input.flags.pfApplicable,
  });
  if (pf.employee > 0) deductions[STATUTORY_CODES.PF_EE] = pf.employee;
  if (pf.employer > 0) employer[STATUTORY_CODES.PF_ER] = pf.employer;

  const esi = computeEsi({
    gross,
    ceiling: input.statutory.esiWageCeiling,
    employeePct: input.statutory.esiEmployeePct,
    employerPct: input.statutory.esiEmployerPct,
    applicable: input.flags.esiApplicable,
  });
  if (esi.employee > 0) deductions[STATUTORY_CODES.ESI_EE] = esi.employee;
  if (esi.employer > 0) employer[STATUTORY_CODES.ESI_ER] = esi.employer;

  const professionalTax = input.flags.ptApplicable ? computeProfessionalTax(input.statutory.ptState, gross, input.month) : 0;
  if (professionalTax > 0) deductions[STATUTORY_CODES.PT] = professionalTax;

  // 4. TDS — spread the remaining projected annual liability over the months left.
  const monthsRemaining = Math.max(1, input.monthsRemainingInFY);
  const declarations: Partial<Record<DeclarationKey, number>> = { ...input.declarations };
  if (input.regime === "OLD" && pf.employee > 0) {
    // Employee PF counts towards 80C automatically.
    declarations["80C"] = (declarations["80C"] ?? 0) + pf.employee * 12;
  }
  const annualTax = computeAnnualTax({
    regime: input.regime,
    annualTaxableSalary: input.projectedAnnualTaxable,
    declarations,
    age: input.age,
    annualProfessionalTax: professionalTax * 12,
    fy: input.fy,
  });
  const tds = Math.max(0, roundRupee((annualTax.totalTax - input.annualTaxAlreadyPaid) / monthsRemaining));
  if (tds > 0) deductions[STATUTORY_CODES.TDS] = tds;

  const totalDeductions = Object.values(deductions).reduce((a, b) => a + b, 0);
  const employerTotal = Object.values(employer).reduce((a, b) => a + b, 0);
  const netPay = roundRupee(gross - totalDeductions);

  return {
    earnings,
    deductions,
    employerContributions: employer,
    gross,
    taxableEarnings,
    totalDeductions,
    netPay,
    employerCost: gross + employerTotal,
    pfEmployee: pf.employee,
    pfEmployer: pf.employer,
    esiEmployee: esi.employee,
    esiEmployer: esi.employer,
    professionalTax,
    tds,
    payableDays,
    lopDays,
    annualTax,
  };
}

// ───────────────────────────── FY helpers ─────────────────────────────

/** Indian FY label for a payroll month, e.g. (2026, 4) → "2026-27". */
export function fyOf(year: number, month: number, startMonth = 4): string {
  const y = month >= startMonth ? year : year - 1;
  return `${y}-${String(y + 1).slice(-2)}`;
}

/** 1 for April … 12 for March. */
export function monthIndexInFy(month: number, startMonth = 4): number {
  return ((month - startMonth + 12) % 12) + 1;
}

/** Months of the FY (year, month) covering payroll months from FY start up to and excluding the given month. */
export function fyMonthsBefore(year: number, month: number, startMonth = 4): { year: number; month: number }[] {
  const idx = monthIndexInFy(month, startMonth);
  const out: { year: number; month: number }[] = [];
  const fyStartYear = month >= startMonth ? year : year - 1;
  for (let i = 0; i < idx - 1; i++) {
    const m = ((startMonth - 1 + i) % 12) + 1;
    const y = fyStartYear + (startMonth - 1 + i >= 12 ? 1 : 0);
    out.push({ year: y, month: m });
  }
  return out;
}

/** Net pay in words (Indian numbering), e.g. 125000 → "One Lakh Twenty Five Thousand". */
export function amountInWords(n: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number) => (x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? " " + ones[x % 10] : ""}`);
  const three = (x: number) => (x >= 100 ? `${ones[Math.floor(x / 100)]} Hundred${x % 100 ? " " + two(x % 100) : ""}` : two(x));
  const v = Math.floor(Math.abs(n));
  if (v === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(v / 10_000_000);
  const lakh = Math.floor((v % 10_000_000) / 100_000);
  const thousand = Math.floor((v % 100_000) / 1000);
  const rest = v % 1000;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (rest) parts.push(three(rest));
  return parts.join(" ");
}
