import { describe, expect, it } from "vitest";
import {
  amountInWords,
  computeAnnualTax,
  computeEsi,
  computeMonthlyStructure,
  computePayslip,
  computePf,
  computeProfessionalTax,
  fyMonthsBefore,
  fyOf,
  monthIndexInFy,
  type ComponentLike,
  type PayslipInput,
} from "./engine";

const STANDARD_LINES = [
  { code: "BASIC", calcType: "PERCENT_OF_CTC" as const, value: 40, type: "EARNING" as const },
  { code: "HRA", calcType: "PERCENT_OF_BASIC" as const, value: 50, type: "EARNING" as const },
  { code: "CONV", calcType: "FIXED" as const, value: 1600, type: "EARNING" as const },
  { code: "SPECIAL", calcType: "BALANCE" as const, value: 0, type: "EARNING" as const },
];

const COMPONENTS: ComponentLike[] = [
  { code: "BASIC", type: "EARNING", isTaxable: true, isProrated: true },
  { code: "HRA", type: "EARNING", isTaxable: true, isProrated: true },
  { code: "CONV", type: "EARNING", isTaxable: true, isProrated: true },
  { code: "SPECIAL", type: "EARNING", isTaxable: true, isProrated: true },
  { code: "PF_EE", type: "DEDUCTION", isTaxable: false, isProrated: false, isStatutory: true },
  { code: "ESI_EE", type: "DEDUCTION", isTaxable: false, isProrated: false, isStatutory: true },
  { code: "PT", type: "DEDUCTION", isTaxable: false, isProrated: false, isStatutory: true },
  { code: "TDS", type: "DEDUCTION", isTaxable: false, isProrated: false, isStatutory: true },
  { code: "PF_ER", type: "EMPLOYER_CONTRIBUTION", isTaxable: false, isProrated: false, isStatutory: true },
  { code: "ESI_ER", type: "EMPLOYER_CONTRIBUTION", isTaxable: false, isProrated: false, isStatutory: true },
];

const STATUTORY = { pfWageCeiling: 15000, pfEmployeePct: 12, pfEmployerPct: 12, esiWageCeiling: 21000, esiEmployeePct: 0.75, esiEmployerPct: 3.25, ptState: "TS" };

function payslipInput(overrides: Partial<PayslipInput> = {}): PayslipInput {
  const monthly = computeMonthlyStructure(1_200_000, STANDARD_LINES); // 1L / month
  return {
    monthly,
    components: COMPONENTS,
    daysInMonth: 30,
    lopDays: 0,
    month: 6,
    statutory: STATUTORY,
    flags: { pfApplicable: true, esiApplicable: false, ptApplicable: true },
    adjustments: [],
    annualTaxAlreadyPaid: 0,
    projectedAnnualTaxable: 1_200_000,
    regime: "NEW",
    declarations: {},
    monthIndexInFY: 3,
    monthsRemainingInFY: 10,
    ...overrides,
  };
}

describe("computeMonthlyStructure", () => {
  it("expands the standard India CTC structure", () => {
    const m = computeMonthlyStructure(1_200_000, STANDARD_LINES);
    expect(m).toEqual({ BASIC: 40000, HRA: 20000, CONV: 1600, SPECIAL: 38400 });
    expect(Object.values(m).reduce((a, b) => a + b, 0)).toBe(100000);
  });

  it("floors BALANCE at zero when fixed lines exceed CTC and rounds to 2 decimals", () => {
    const m = computeMonthlyStructure(100_000, [
      { code: "BASIC", calcType: "PERCENT_OF_CTC", value: 33.33, type: "EARNING" },
      { code: "CONV", calcType: "FIXED", value: 10000, type: "EARNING" },
      { code: "SPECIAL", calcType: "BALANCE", value: 0, type: "EARNING" },
    ]);
    expect(m.BASIC).toBe(2777.5);
    expect(m.SPECIAL).toBe(0);
  });

  it("computes PERCENT_OF_GROSS from earnings so far and ignores employer lines in the balance", () => {
    const m = computeMonthlyStructure(600_000, [
      { code: "BASIC", calcType: "PERCENT_OF_CTC", value: 50, type: "EARNING" },
      { code: "BONUS", calcType: "PERCENT_OF_GROSS", value: 10, type: "EARNING" },
      { code: "PF_ER", calcType: "PERCENT_OF_BASIC", value: 12, type: "EMPLOYER_CONTRIBUTION" },
      { code: "SPECIAL", calcType: "BALANCE", value: 0, type: "EARNING" },
    ]);
    expect(m.BASIC).toBe(25000);
    expect(m.BONUS).toBe(2500);
    expect(m.PF_ER).toBe(3000);
    expect(m.SPECIAL).toBe(22500);
  });
});

describe("computeProfessionalTax", () => {
  it("applies Telangana slabs", () => {
    expect(computeProfessionalTax("TS", 15000, 1)).toBe(0);
    expect(computeProfessionalTax("TS", 18000, 1)).toBe(150);
    expect(computeProfessionalTax("TS", 50000, 1)).toBe(200);
  });
  it("applies Karnataka, Gujarat, West Bengal and Tamil Nadu slabs", () => {
    expect(computeProfessionalTax("KA", 25000, 5)).toBe(0);
    expect(computeProfessionalTax("KA", 25001, 5)).toBe(200);
    expect(computeProfessionalTax("GJ", 12000, 5)).toBe(0);
    expect(computeProfessionalTax("GJ", 30000, 5)).toBe(200);
    expect(computeProfessionalTax("WB", 12000, 5)).toBe(110);
    expect(computeProfessionalTax("WB", 30000, 5)).toBe(150);
    expect(computeProfessionalTax("WB", 45000, 5)).toBe(200);
    expect(computeProfessionalTax("TN", 21000, 5)).toBe(0);
    expect(computeProfessionalTax("TN", 30000, 5)).toBe(208);
  });
  it("charges Maharashtra 300 in February and 200 otherwise, accepts state names, unknown states are 0", () => {
    expect(computeProfessionalTax("MH", 30000, 2)).toBe(300);
    expect(computeProfessionalTax("MH", 30000, 3)).toBe(200);
    expect(computeProfessionalTax("MH", 8000, 3)).toBe(175);
    expect(computeProfessionalTax("Maharashtra", 30000, 1)).toBe(200);
    expect(computeProfessionalTax("DL", 100000, 1)).toBe(0);
    expect(computeProfessionalTax(null, 100000, 1)).toBe(0);
  });
});

describe("computePf", () => {
  it("caps PF wage at the ceiling and splits employer share into EPS/EPF", () => {
    const pf = computePf({ basic: 50000, pfWageCeiling: 15000, applicable: true });
    expect(pf).toEqual({ wage: 15000, employee: 1800, employer: 1800, eps: 1250, epf: 550 });
  });
  it("uses actual basic below the ceiling and returns zero when not applicable", () => {
    const pf = computePf({ basic: 10000, applicable: true });
    expect(pf.employee).toBe(1200);
    expect(pf.eps).toBe(833);
    expect(pf.epf).toBe(367);
    expect(computePf({ basic: 10000, applicable: false }).employee).toBe(0);
  });
});

describe("computeEsi", () => {
  it("applies only up to the wage ceiling and rounds contributions up", () => {
    expect(computeEsi({ gross: 20001, applicable: true })).toEqual({ employee: 151, employer: 651 }); // 150.0075 → 151, 650.03 → 651
    expect(computeEsi({ gross: 20000, applicable: true })).toEqual({ employee: 150, employer: 650 });
    expect(computeEsi({ gross: 21001, applicable: true })).toEqual({ employee: 0, employer: 0 });
    expect(computeEsi({ gross: 15000, applicable: false })).toEqual({ employee: 0, employer: 0 });
  });
});

describe("computeAnnualTax — NEW regime", () => {
  it("is nil up to 12L taxable income via 87A rebate (12.75L salary)", () => {
    const t = computeAnnualTax({ regime: "NEW", annualTaxableSalary: 1_275_000 });
    expect(t.taxableIncome).toBe(1_200_000);
    expect(t.slabTax).toBe(60_000);
    expect(t.totalTax).toBe(0);
    expect(t.monthlyTds).toBe(0);
  });
  it("applies marginal relief just above 12L", () => {
    const t = computeAnnualTax({ regime: "NEW", annualTaxableSalary: 1_285_000 }); // taxable 12.10L
    // slab tax = 60000 + 10000*15% = 61500; relief caps tax at 10000 excess
    expect(t.taxBeforeCess).toBe(10_000);
    expect(t.cess).toBe(400);
    expect(t.totalTax).toBe(10_400);
  });
  it("computes full slab tax with cess above the relief zone and ignores 80C", () => {
    const t = computeAnnualTax({ regime: "NEW", annualTaxableSalary: 2_475_000, declarations: { "80C": 150_000 } });
    // taxable 24L → 0 + 20000 + 40000 + 60000 + 80000 + 100000 = 300000
    expect(t.taxableIncome).toBe(2_400_000);
    expect(t.taxBeforeCess).toBe(300_000);
    expect(t.cess).toBe(12_000);
    expect(t.totalTax).toBe(312_000);
    expect(t.monthlyTds).toBe(26_000);
  });
  it("adds 10% surcharge above 50L with marginal relief", () => {
    const t = computeAnnualTax({ regime: "NEW", annualTaxableSalary: 6_075_000 }); // taxable 60L
    const slab = 300_000 + (6_000_000 - 2_400_000) * 0.3; // 1,380,000
    expect(t.taxBeforeCess).toBe(slab);
    expect(t.surcharge).toBe(slab * 0.1);
    expect(t.totalTax).toBe(Math.round(slab * 1.1 * 1.04));
    const edge = computeAnnualTax({ regime: "NEW", annualTaxableSalary: 5_085_000 }); // taxable 50.10L
    expect(edge.surcharge).toBeLessThan(edge.taxBeforeCess * 0.1); // marginal relief kicked in
    expect(edge.surcharge).toBeGreaterThan(0);
  });
});

describe("computeAnnualTax — OLD regime", () => {
  it("applies 80C / 80D / HRA / 24B caps, standard deduction 50k and 5L rebate", () => {
    const t = computeAnnualTax({
      regime: "OLD",
      annualTaxableSalary: 1_200_000,
      declarations: { "80C": 200_000, "80D": 30_000, HRA_EXEMPT: 120_000, "24B": 250_000, "80TTA": 15_000 },
    });
    // deductions: 150000 + 25000 + 120000 + 200000 + 10000 = 505000; taxable = 1200000 - 50000 - 505000 = 645000
    expect(t.deductions).toBe(505_000);
    expect(t.taxableIncome).toBe(645_000);
    // 12500 + 145000*20% = 41500 → cess 1660
    expect(t.taxBeforeCess).toBe(41_500);
    expect(t.totalTax).toBe(43_160);
    const nil = computeAnnualTax({ regime: "OLD", annualTaxableSalary: 700_000, declarations: { "80C": 150_000 } });
    expect(nil.taxableIncome).toBe(500_000);
    expect(nil.totalTax).toBe(0);
  });
  it("doubles the 80D cap for senior citizens and uses the senior basic exemption", () => {
    const t = computeAnnualTax({ regime: "OLD", annualTaxableSalary: 900_000, declarations: { "80D": 60_000 }, age: 62 });
    expect(t.deductions).toBe(50_000);
    expect(t.taxableIncome).toBe(800_000);
    // senior slabs: 0-3L nil, 3-5L 5% = 10000, 5-8L 20% = 60000 → 70000
    expect(t.taxBeforeCess).toBe(70_000);
  });
});

describe("computePayslip", () => {
  it("computes a full-month payslip with PF, PT and TDS and balances net pay", () => {
    const p = computePayslip(payslipInput({ projectedAnnualTaxable: 1_200_000 }));
    expect(p.gross).toBe(100_000);
    expect(p.payableDays).toBe(30);
    expect(p.pfEmployee).toBe(1800);
    expect(p.pfEmployer).toBe(1800);
    expect(p.professionalTax).toBe(200);
    expect(p.tds).toBe(0); // 12L NEW regime → nil
    expect(p.totalDeductions).toBe(2000);
    expect(p.netPay).toBe(98_000);
    expect(p.netPay).toBe(p.gross - p.totalDeductions);
    expect(p.employerCost).toBe(101_800);
    expect(p.deductions).toEqual({ PF_EE: 1800, PT: 200 });
  });

  it("prorates earnings by payable days when there is LOP", () => {
    const p = computePayslip(payslipInput({ lopDays: 3, daysInMonth: 30 }));
    expect(p.payableDays).toBe(27);
    expect(p.earnings.BASIC).toBe(36_000);
    expect(p.earnings.HRA).toBe(18_000);
    expect(p.earnings.CONV).toBe(1440);
    expect(p.gross).toBe(90_000);
    expect(p.pfEmployee).toBe(1800); // basic still above ceiling
  });

  it("does not prorate components flagged isProrated=false", () => {
    const comps = COMPONENTS.map((c) => (c.code === "CONV" ? { ...c, isProrated: false } : c));
    const p = computePayslip(payslipInput({ lopDays: 15, daysInMonth: 30, components: comps }));
    expect(p.earnings.CONV).toBe(1600);
    expect(p.earnings.BASIC).toBe(20_000);
  });

  it("includes one-off adjustments and applies ESI for low-wage employees", () => {
    const monthly = computeMonthlyStructure(216_000, STANDARD_LINES); // 18k / month
    const p = computePayslip(
      payslipInput({
        monthly,
        projectedAnnualTaxable: 216_000,
        flags: { pfApplicable: true, esiApplicable: true, ptApplicable: true },
        adjustments: [
          { code: "BONUS", label: "Bonus", type: "EARNING", amount: 1000, isTaxable: true },
          { code: "ADV", label: "Advance recovery", type: "DEDUCTION", amount: 500, isTaxable: false },
        ],
      }),
    );
    expect(p.earnings.BONUS).toBe(1000);
    expect(p.gross).toBe(19_000);
    expect(p.esiEmployee).toBe(Math.ceil(19_000 * 0.0075)); // 143
    expect(p.esiEmployer).toBe(Math.ceil(19_000 * 0.0325)); // 618
    expect(p.pfEmployee).toBe(864); // 12% of 7200 basic
    expect(p.professionalTax).toBe(150);
    expect(p.deductions.ADV).toBe(500);
    expect(p.netPay).toBe(p.gross - p.totalDeductions);
  });

  it("spreads the remaining annual tax over the months left in the FY", () => {
    const p = computePayslip(
      payslipInput({
        monthly: computeMonthlyStructure(2_400_000, STANDARD_LINES),
        projectedAnnualTaxable: 2_475_000, // total tax 312,000
        annualTaxAlreadyPaid: 52_000, // two months already deducted at 26k
        monthIndexInFY: 3,
        monthsRemainingInFY: 10,
      }),
    );
    expect(p.tds).toBe(26_000);
    const catchUp = computePayslip(payslipInput({ monthly: computeMonthlyStructure(2_400_000, STANDARD_LINES), projectedAnnualTaxable: 2_475_000, annualTaxAlreadyPaid: 0, monthIndexInFY: 7, monthsRemainingInFY: 6 }));
    expect(catchUp.tds).toBe(52_000);
    const overpaid = computePayslip(payslipInput({ projectedAnnualTaxable: 1_200_000, annualTaxAlreadyPaid: 5000 }));
    expect(overpaid.tds).toBe(0);
  });

  it("OLD regime: employee PF counts towards 80C and PT is deductible", () => {
    const p = computePayslip(payslipInput({ regime: "OLD", projectedAnnualTaxable: 1_200_000, declarations: { "80C": 100_000 } }));
    // 80C = 100000 + 1800*12 = 121600; PT 2400; taxable = 1200000 - 50000 - 121600 - 2400 = 1026000
    expect(p.annualTax.taxableIncome).toBe(1_026_000);
    expect(p.annualTax.taxBeforeCess).toBe(12_500 + 100_000 + 26_000 * 0.3);
  });

  it("skips statutory deductions when flags are off", () => {
    const p = computePayslip(payslipInput({ flags: { pfApplicable: false, esiApplicable: false, ptApplicable: false } }));
    expect(p.pfEmployee).toBe(0);
    expect(p.professionalTax).toBe(0);
    expect(p.employerContributions).toEqual({});
    expect(p.netPay).toBe(100_000);
  });
});

describe("FY helpers", () => {
  it("labels FY and month index correctly", () => {
    expect(fyOf(2026, 4)).toBe("2026-27");
    expect(fyOf(2027, 3)).toBe("2026-27");
    expect(fyOf(2026, 1)).toBe("2025-26");
    expect(monthIndexInFy(4)).toBe(1);
    expect(monthIndexInFy(3)).toBe(12);
    expect(fyMonthsBefore(2026, 4)).toEqual([]);
    expect(fyMonthsBefore(2027, 1)).toEqual([
      { year: 2026, month: 4 }, { year: 2026, month: 5 }, { year: 2026, month: 6 }, { year: 2026, month: 7 }, { year: 2026, month: 8 },
      { year: 2026, month: 9 }, { year: 2026, month: 10 }, { year: 2026, month: 11 }, { year: 2026, month: 12 },
    ]);
  });
  it("spells amounts in Indian numbering", () => {
    expect(amountInWords(125_000)).toBe("One Lakh Twenty Five Thousand");
    expect(amountInWords(98_000)).toBe("Ninety Eight Thousand");
    expect(amountInWords(10_500_001)).toBe("One Crore Five Lakh One");
  });
});
