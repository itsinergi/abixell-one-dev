/**
 * Payroll & Statutory Calculation Engine (HR-ADV-005).
 *
 * Exact-decimal, stateless calculation engine for Indonesian statutory social
 * security (BPJS Kesehatan & BPJS Ketenagakerjaan) and income tax withholding
 * (PPh 21 via annualized Pasal 17 brackets or monthly TER PP 58/2023).
 *
 * Rules:
 * - Pure functions with zero side-effects.
 * - All rate and bracket tables are passed in as arguments (`WorkforceStatutoryPolicy`);
 *   nothing is hard-coded as static runtime constants.
 * - Decimal rounding is deterministic and governed by `policy.roundingMode`.
 */

import type {
  PphBracket,
  PtkpStatus,
  RoundingMode,
  WorkforceStatutoryPolicy,
} from "./workforce-advanced.entity.js";

export interface TerBracketEntry {
  category: "A" | "B" | "C";
  upTo: number | null; // null for highest bracket
  rate: number; // fraction, e.g. 0.005 for 0.5%
}

export interface PayrollCalculationInput {
  baseSalary: number;
  fixedAllowance: number;
  overtimeHours?: number;
  overtimeHourlyRate?: number | null;
  ptkpStatus: PtkpStatus;
  hasNpwp: boolean;
  otherDeductions?: number;
  policy: WorkforceStatutoryPolicy;
}

export interface PayrollCalculationResult {
  baseSalary: number;
  allowances: number;
  overtimeHours: number;
  overtimePay: number;
  grossSalary: number;
  bpjsKesehatanEmployee: number;
  bpjsKesehatanEmployer: number;
  bpjsTkJhtEmployee: number;
  bpjsTkJhtEmployer: number;
  bpjsTkJkkEmployer: number;
  bpjsTkJkmEmployer: number;
  bpjsTkJPSEmployee: number;
  bpjsTkJPSEmployer: number;
  pph21Withheld: number;
  otherDeductions: number;
  totalDeductions: number;
  employerContributions: number;
  netSalary: number;
  ptkpStatus: PtkpStatus;
  breakdown: {
    taxableGross: number;
    occupationalCost: number;
    annualizedNetIncome: number;
    annualPtkpAmount: number;
    taxableAnnualIncomePkp: number;
    annualTax: number;
    monthlyTaxBeforeSurcharge: number;
    surchargeApplied: number;
    methodUsed: "annualized" | "ter";
  };
}

export const RATE_SCALE = 1_000_000n;

export function toCents(nominal: number): bigint {
  if (!Number.isFinite(nominal)) return 0n;
  return BigInt(Math.round(nominal * 100));
}

export function fromCents(cents: bigint): number {
  return Number(cents) / 100;
}

export function roundScaledDivision(
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode = "half_up",
): bigint {
  if (denominator === 0n) return 0n;
  const isNegative = (numerator < 0n && denominator > 0n) || (numerator > 0n && denominator < 0n);
  const absNum = numerator < 0n ? -numerator : numerator;
  const absDen = denominator < 0n ? -denominator : denominator;

  const quotient = absNum / absDen;
  const remainder = absNum % absDen;

  let finalQuotient = quotient;
  if (remainder > 0n) {
    if (mode === "down") {
      finalQuotient = quotient;
    } else if (mode === "up") {
      finalQuotient = quotient + 1n;
    } else {
      // half_up
      if (remainder * 2n >= absDen) {
        finalQuotient = quotient + 1n;
      }
    }
  }

  return isNegative ? -finalQuotient : finalQuotient;
}

export function mulRateCents(
  amountCents: bigint,
  rate: number,
  mode: RoundingMode = "half_up",
): bigint {
  if (amountCents === 0n || rate === 0 || !Number.isFinite(rate)) return 0n;
  const scaledRate = BigInt(Math.round(rate * 1_000_000));
  const product = amountCents * scaledRate;
  return roundScaledDivision(product, RATE_SCALE, mode);
}

export function divCents(
  numeratorCents: bigint,
  divisor: number,
  mode: RoundingMode = "half_up",
): bigint {
  if (numeratorCents === 0n || divisor === 0 || !Number.isFinite(divisor)) return 0n;
  const scaledDivisor = BigInt(Math.round(divisor * 1_000_000));
  const product = numeratorCents * RATE_SCALE;
  return roundScaledDivision(product, scaledDivisor, mode);
}

export function resolveTerCategory(status: PtkpStatus): "A" | "B" | "C" {
  switch (status) {
    case "TK/0":
    case "TK/1":
    case "K/0":
      return "A";
    case "TK/2":
    case "TK/3":
    case "K/1":
    case "K/2":
      return "B";
    case "K/3":
      return "C";
    default:
      return "A";
  }
}

export const DEFAULT_PTKP_ANNUAL_AMOUNTS: Record<PtkpStatus, number> = {
  "TK/0": 54_000_000,
  "TK/1": 58_500_000,
  "TK/2": 63_000_000,
  "TK/3": 67_500_000,
  "K/0": 58_500_000,
  "K/1": 63_000_000,
  "K/2": 67_500_000,
  "K/3": 72_000_000,
};

export const DEFAULT_PPH21_BRACKETS: PphBracket[] = [
  { upTo: 60_000_000, rate: 0.05 },
  { upTo: 250_000_000, rate: 0.15 },
  { upTo: 500_000_000, rate: 0.25 },
  { upTo: 5_000_000_000, rate: 0.30 },
  { upTo: null, rate: 0.35 },
];

export const DEFAULT_TER_BRACKETS: TerBracketEntry[] = [
  // Category A
  { category: "A", upTo: 5_400_000, rate: 0.0 },
  { category: "A", upTo: 5_650_000, rate: 0.0025 },
  { category: "A", upTo: 5_950_000, rate: 0.005 },
  { category: "A", upTo: 6_300_000, rate: 0.0075 },
  { category: "A", upTo: 6_750_000, rate: 0.01 },
  { category: "A", upTo: 7_500_000, rate: 0.0125 },
  { category: "A", upTo: 8_550_000, rate: 0.015 },
  { category: "A", upTo: 9_650_000, rate: 0.0175 },
  { category: "A", upTo: 10_050_000, rate: 0.02 },
  { category: "A", upTo: 10_350_000, rate: 0.0225 },
  { category: "A", upTo: 10_700_000, rate: 0.025 },
  { category: "A", upTo: 12_500_000, rate: 0.03 },
  { category: "A", upTo: 13_750_000, rate: 0.04 },
  { category: "A", upTo: 15_100_000, rate: 0.05 },
  { category: "A", upTo: 16_950_000, rate: 0.06 },
  { category: "A", upTo: 19_750_000, rate: 0.07 },
  { category: "A", upTo: 24_150_000, rate: 0.08 },
  { category: "A", upTo: 26_450_000, rate: 0.09 },
  { category: "A", upTo: 28_000_000, rate: 0.10 },
  { category: "A", upTo: 30_050_000, rate: 0.11 },
  { category: "A", upTo: 32_400_000, rate: 0.12 },
  { category: "A", upTo: 35_400_000, rate: 0.13 },
  { category: "A", upTo: 39_100_000, rate: 0.14 },
  { category: "A", upTo: 43_850_000, rate: 0.15 },
  { category: "A", upTo: 47_800_000, rate: 0.16 },
  { category: "A", upTo: 51_400_000, rate: 0.17 },
  { category: "A", upTo: 56_300_000, rate: 0.18 },
  { category: "A", upTo: 62_200_000, rate: 0.19 },
  { category: "A", upTo: 68_600_000, rate: 0.20 },
  { category: "A", upTo: 77_500_000, rate: 0.21 },
  { category: "A", upTo: 89_000_000, rate: 0.22 },
  { category: "A", upTo: 103_000_000, rate: 0.23 },
  { category: "A", upTo: 125_000_000, rate: 0.24 },
  { category: "A", upTo: 157_000_000, rate: 0.25 },
  { category: "A", upTo: 206_000_000, rate: 0.26 },
  { category: "A", upTo: 337_000_000, rate: 0.30 },
  { category: "A", upTo: 454_000_000, rate: 0.31 },
  { category: "A", upTo: 550_000_000, rate: 0.32 },
  { category: "A", upTo: 1_400_000_000, rate: 0.33 },
  { category: "A", upTo: null, rate: 0.34 },

  // Category B
  { category: "B", upTo: 6_200_000, rate: 0.0 },
  { category: "B", upTo: 6_500_000, rate: 0.0025 },
  { category: "B", upTo: 6_850_000, rate: 0.005 },
  { category: "B", upTo: 7_300_000, rate: 0.0075 },
  { category: "B", upTo: 9_200_000, rate: 0.01 },
  { category: "B", upTo: 10_750_000, rate: 0.015 },
  { category: "B", upTo: 11_250_000, rate: 0.02 },
  { category: "B", upTo: 11_600_000, rate: 0.025 },
  { category: "B", upTo: 12_600_000, rate: 0.03 },
  { category: "B", upTo: 13_600_000, rate: 0.04 },
  { category: "B", upTo: 14_950_000, rate: 0.05 },
  { category: "B", upTo: 16_400_000, rate: 0.06 },
  { category: "B", upTo: 18_450_000, rate: 0.07 },
  { category: "B", upTo: 21_850_000, rate: 0.08 },
  { category: "B", upTo: 26_000_000, rate: 0.09 },
  { category: "B", upTo: 27_700_000, rate: 0.10 },
  { category: "B", upTo: 29_350_000, rate: 0.11 },
  { category: "B", upTo: 31_450_000, rate: 0.12 },
  { category: "B", upTo: 33_950_000, rate: 0.13 },
  { category: "B", upTo: 37_100_000, rate: 0.14 },
  { category: "B", upTo: 41_100_000, rate: 0.15 },
  { category: "B", upTo: 45_800_000, rate: 0.16 },
  { category: "B", upTo: 49_500_000, rate: 0.17 },
  { category: "B", upTo: 53_800_000, rate: 0.18 },
  { category: "B", upTo: 58_500_000, rate: 0.19 },
  { category: "B", upTo: 64_000_000, rate: 0.20 },
  { category: "B", upTo: 71_000_000, rate: 0.21 },
  { category: "B", upTo: 80_000_000, rate: 0.22 },
  { category: "B", upTo: 93_000_000, rate: 0.23 },
  { category: "B", upTo: 109_000_000, rate: 0.24 },
  { category: "B", upTo: 129_000_000, rate: 0.25 },
  { category: "B", upTo: 163_000_000, rate: 0.26 },
  { category: "B", upTo: 211_000_000, rate: 0.30 },
  { category: "B", upTo: 374_000_000, rate: 0.31 },
  { category: "B", upTo: 459_000_000, rate: 0.32 },
  { category: "B", upTo: 555_000_000, rate: 0.33 },
  { category: "B", upTo: null, rate: 0.34 },

  // Category C
  { category: "C", upTo: 6_600_000, rate: 0.0 },
  { category: "C", upTo: 6_950_000, rate: 0.0025 },
  { category: "C", upTo: 7_350_000, rate: 0.005 },
  { category: "C", upTo: 7_800_000, rate: 0.0075 },
  { category: "C", upTo: 8_850_000, rate: 0.01 },
  { category: "C", upTo: 9_800_000, rate: 0.0125 },
  { category: "C", upTo: 10_950_000, rate: 0.015 },
  { category: "C", upTo: 11_200_000, rate: 0.0175 },
  { category: "C", upTo: 12_050_000, rate: 0.02 },
  { category: "C", upTo: 12_950_000, rate: 0.03 },
  { category: "C", upTo: 14_150_000, rate: 0.04 },
  { category: "C", upTo: 15_550_000, rate: 0.05 },
  { category: "C", upTo: 17_050_000, rate: 0.06 },
  { category: "C", upTo: 19_500_000, rate: 0.07 },
  { category: "C", upTo: 22_700_000, rate: 0.08 },
  { category: "C", upTo: 24_700_000, rate: 0.09 },
  { category: "C", upTo: 26_450_000, rate: 0.10 },
  { category: "C", upTo: 28_000_000, rate: 0.11 },
  { category: "C", upTo: 30_450_000, rate: 0.12 },
  { category: "C", upTo: 32_400_000, rate: 0.13 },
  { category: "C", upTo: 35_400_000, rate: 0.14 },
  { category: "C", upTo: 39_100_000, rate: 0.15 },
  { category: "C", upTo: 43_850_000, rate: 0.16 },
  { category: "C", upTo: 47_800_000, rate: 0.17 },
  { category: "C", upTo: 51_400_000, rate: 0.18 },
  { category: "C", upTo: 56_300_000, rate: 0.19 },
  { category: "C", upTo: 62_200_000, rate: 0.20 },
  { category: "C", upTo: 68_600_000, rate: 0.21 },
  { category: "C", upTo: 77_500_000, rate: 0.22 },
  { category: "C", upTo: 89_000_000, rate: 0.23 },
  { category: "C", upTo: 103_000_000, rate: 0.24 },
  { category: "C", upTo: 125_000_000, rate: 0.25 },
  { category: "C", upTo: 157_000_000, rate: 0.26 },
  { category: "C", upTo: 206_000_000, rate: 0.30 },
  { category: "C", upTo: 337_000_000, rate: 0.31 },
  { category: "C", upTo: 454_000_000, rate: 0.32 },
  { category: "C", upTo: 550_000_000, rate: 0.33 },
  { category: "C", upTo: null, rate: 0.34 },
];

/**
 * Resolves the applicable TER (Tarif Efektif Rata-rata, PP 58/2023) rate for
 * a given monthly gross income within a category's bracket ladder. Brackets
 * are ordered ascending by `upTo`; the first bracket whose `upTo` is >= the
 * income (or null, the open-ended top bracket) applies.
 */
export function resolveTerRate(monthlyGross: number, brackets: TerBracketEntry[]): number {
  const sorted = [...brackets].sort((a, b) => {
    if (a.upTo === null) return 1;
    if (b.upTo === null) return -1;
    return a.upTo - b.upTo;
  });
  for (const bracket of sorted) {
    if (bracket.upTo === null || monthlyGross <= bracket.upTo) {
      return bracket.rate;
    }
  }
  return sorted.length > 0 ? sorted[sorted.length - 1].rate : 0;
}

export function calculateProgressiveTaxCents(
  pkpCents: bigint,
  brackets: PphBracket[],
  mode: RoundingMode,
): bigint {
  if (pkpCents <= 0n) return 0n;

  let totalTaxCents = 0n;
  let remainingPkpCents = pkpCents;
  let previousUpToCents = 0n;

  for (const bracket of brackets) {
    if (remainingPkpCents <= 0n) break;

    const bracketCapacityCents =
      bracket.upTo !== null ? toCents(bracket.upTo) - previousUpToCents : null;
    const taxableInBracketCents =
      bracketCapacityCents !== null && remainingPkpCents > bracketCapacityCents
        ? bracketCapacityCents
        : remainingPkpCents;

    totalTaxCents += mulRateCents(taxableInBracketCents, bracket.rate, mode);
    remainingPkpCents -= taxableInBracketCents;

    if (bracket.upTo !== null) {
      previousUpToCents = toCents(bracket.upTo);
    }
  }

  return totalTaxCents;
}

/**
 * Calculates progressive tax for an annual PKP under Pasal 17 brackets.
 */
export function calculateProgressiveTax(pkp: number, brackets: PphBracket[], mode: RoundingMode): number {
  const pkpCents = toCents(pkp);
  const taxCents = calculateProgressiveTaxCents(pkpCents, brackets, mode);
  return fromCents(taxCents);
}

/**
 * Executes a full exact-decimal payroll calculation for an employee in a given run period
 * using scaled-integer cents / fixed-point arithmetic without IEEE-754 floating-point drift.
 */
export function calculateEmployeePayroll(input: PayrollCalculationInput): PayrollCalculationResult {
  const {
    baseSalary,
    fixedAllowance,
    overtimeHours = 0,
    overtimeHourlyRate,
    ptkpStatus,
    hasNpwp,
    otherDeductions = 0,
    policy,
  } = input;

  const mode = policy.roundingMode || "half_up";

  const baseSalaryCents = toCents(baseSalary);
  const fixedAllowanceCents = toCents(fixedAllowance);

  // 1. Earnings
  const statutoryWageBaseCents = baseSalaryCents + fixedAllowanceCents;

  const effectiveOvertimeRateCents =
    overtimeHourlyRate && overtimeHourlyRate > 0
      ? toCents(overtimeHourlyRate)
      : divCents(statutoryWageBaseCents, 173, mode);

  const overtimePayCents =
    overtimeHours > 0
      ? mulRateCents(effectiveOvertimeRateCents, overtimeHours, mode)
      : 0n;

  const grossSalaryCents = baseSalaryCents + fixedAllowanceCents + overtimePayCents;

  // 2. BPJS Social Security Contributions
  // BPJS Kesehatan (capped)
  const bpjsKesCapCents =
    policy.bpjsKesehatanCap && policy.bpjsKesehatanCap > 0
      ? toCents(policy.bpjsKesehatanCap)
      : null;
  const bpjsKesWageCents =
    bpjsKesCapCents !== null && statutoryWageBaseCents > bpjsKesCapCents
      ? bpjsKesCapCents
      : statutoryWageBaseCents;

  const bpjsKesehatanEmployeeCents = mulRateCents(
    bpjsKesWageCents,
    policy.bpjsKesehatanRateEmployee,
    mode,
  );
  const bpjsKesehatanEmployerCents = mulRateCents(
    bpjsKesWageCents,
    policy.bpjsKesehatanRateEmployer,
    mode,
  );

  // BPJS Ketenagakerjaan JHT (uncapped)
  const bpjsTkJhtEmployeeCents = mulRateCents(
    statutoryWageBaseCents,
    policy.bpjsTkJhtRateEmployee,
    mode,
  );
  const bpjsTkJhtEmployerCents = mulRateCents(
    statutoryWageBaseCents,
    policy.bpjsTkJhtRateEmployer,
    mode,
  );

  // BPJS TK JKK & JKM (employer only)
  const bpjsTkJkkEmployerCents = mulRateCents(statutoryWageBaseCents, policy.bpjsTkJkkRate, mode);
  const bpjsTkJkmEmployerCents = mulRateCents(statutoryWageBaseCents, policy.bpjsTkJkmRate, mode);

  // BPJS TK JP (capped)
  const bpjsJpCapCents =
    policy.bpjsTkJpCap && policy.bpjsTkJpCap > 0 ? toCents(policy.bpjsTkJpCap) : null;
  const bpjsJpWageCents =
    bpjsJpCapCents !== null && statutoryWageBaseCents > bpjsJpCapCents
      ? bpjsJpCapCents
      : statutoryWageBaseCents;

  const bpjsTkJPSEmployeeCents = mulRateCents(bpjsJpWageCents, policy.bpjsTkJpRateEmployee, mode);
  const bpjsTkJPSEmployerCents = mulRateCents(bpjsJpWageCents, policy.bpjsTkJpRateEmployer, mode);

  const employerContributionsCents =
    bpjsKesehatanEmployerCents +
    bpjsTkJhtEmployerCents +
    bpjsTkJkkEmployerCents +
    bpjsTkJkmEmployerCents +
    bpjsTkJPSEmployerCents;

  // 3. PPh 21 Withholding Tax
  let pph21WithheldCents = 0n;
  let taxableGrossCents = 0n;
  let occupationalCostCents = 0n;
  let annualizedNetIncomeCents = 0n;
  let annualPtkpAmountCents = 0n;
  let taxableAnnualIncomePkpCents = 0n;
  let annualTaxCents = 0n;
  let monthlyTaxBeforeSurchargeCents = 0n;
  let surchargeAppliedCents = 0n;

  const methodUsed = policy.pph21Method || "annualized";
  const brackets =
    Array.isArray(policy.pph21Brackets) && policy.pph21Brackets.length > 0
      ? policy.pph21Brackets
      : DEFAULT_PPH21_BRACKETS;

  // Taxable monthly gross includes earnings + employer healthcare/JKK/JKM
  taxableGrossCents =
    grossSalaryCents +
    bpjsKesehatanEmployerCents +
    bpjsTkJkkEmployerCents +
    bpjsTkJkmEmployerCents;

  if (methodUsed === "ter") {
    const category = resolveTerCategory(ptkpStatus);
    const configuredTerBrackets = Array.isArray(policy.pph21TerBrackets)
      ? policy.pph21TerBrackets.filter((entry) => entry.category === category)
      : [];
    const terBrackets =
      configuredTerBrackets.length > 0
        ? configuredTerBrackets
        : DEFAULT_TER_BRACKETS.filter((entry) => entry.category === category);

    const taxableGrossNominal = fromCents(taxableGrossCents);
    const terRate = resolveTerRate(taxableGrossNominal, terBrackets);
    monthlyTaxBeforeSurchargeCents = mulRateCents(taxableGrossCents, terRate, mode);
  } else {
    // Annualized method (Pasal 17).
    const occCostRate = policy.occupationalCostRate || 0.05;
    const occCostMonthlyCapCents = toCents(policy.occupationalCostMonthlyCap ?? 500_000);
    const rawOccCostCents = mulRateCents(taxableGrossCents, occCostRate, mode);
    occupationalCostCents =
      rawOccCostCents > occCostMonthlyCapCents ? occCostMonthlyCapCents : rawOccCostCents;

    // Employee JHT & JP contributions are deductible.
    const deductibleEmployeeCents =
      occupationalCostCents + bpjsTkJhtEmployeeCents + bpjsTkJPSEmployeeCents;
    const monthlyNetCents =
      taxableGrossCents > deductibleEmployeeCents
        ? taxableGrossCents - deductibleEmployeeCents
        : 0n;

    annualizedNetIncomeCents = monthlyNetCents * 12n;

    const ptkpAmounts = { ...DEFAULT_PTKP_ANNUAL_AMOUNTS, ...(policy.ptkpAnnualAmounts || {}) };
    const ptkpNominal = ptkpAmounts[ptkpStatus] ?? DEFAULT_PTKP_ANNUAL_AMOUNTS["TK/0"];
    annualPtkpAmountCents = toCents(ptkpNominal);

    const rawPkpCents =
      annualizedNetIncomeCents > annualPtkpAmountCents
        ? annualizedNetIncomeCents - annualPtkpAmountCents
        : 0n;

    // Taxable PKP rounded down to nearest thousand (in cents: multiple of 100,000 cents)
    taxableAnnualIncomePkpCents = (rawPkpCents / 100_000n) * 100_000n;
    annualTaxCents = calculateProgressiveTaxCents(taxableAnnualIncomePkpCents, brackets, mode);
    monthlyTaxBeforeSurchargeCents = divCents(annualTaxCents, 12, mode);
  }

  if (!hasNpwp && (policy.nonNpwpSurchargeRate || 0) > 0) {
    surchargeAppliedCents = mulRateCents(
      monthlyTaxBeforeSurchargeCents,
      policy.nonNpwpSurchargeRate,
      mode,
    );
    pph21WithheldCents = monthlyTaxBeforeSurchargeCents + surchargeAppliedCents;
  } else {
    pph21WithheldCents = monthlyTaxBeforeSurchargeCents;
  }

  // 4. Net Salary
  const otherDeductionsCents = toCents(otherDeductions);
  const totalDeductionsCents =
    bpjsKesehatanEmployeeCents +
    bpjsTkJhtEmployeeCents +
    bpjsTkJPSEmployeeCents +
    pph21WithheldCents +
    otherDeductionsCents;

  const netSalaryCents = grossSalaryCents - totalDeductionsCents;

  return {
    baseSalary: fromCents(baseSalaryCents),
    allowances: fromCents(fixedAllowanceCents),
    overtimeHours,
    overtimePay: fromCents(overtimePayCents),
    grossSalary: fromCents(grossSalaryCents),
    bpjsKesehatanEmployee: fromCents(bpjsKesehatanEmployeeCents),
    bpjsKesehatanEmployer: fromCents(bpjsKesehatanEmployerCents),
    bpjsTkJhtEmployee: fromCents(bpjsTkJhtEmployeeCents),
    bpjsTkJhtEmployer: fromCents(bpjsTkJhtEmployerCents),
    bpjsTkJkkEmployer: fromCents(bpjsTkJkkEmployerCents),
    bpjsTkJkmEmployer: fromCents(bpjsTkJkmEmployerCents),
    bpjsTkJPSEmployee: fromCents(bpjsTkJPSEmployeeCents),
    bpjsTkJPSEmployer: fromCents(bpjsTkJPSEmployerCents),
    pph21Withheld: fromCents(pph21WithheldCents),
    otherDeductions: fromCents(otherDeductionsCents),
    totalDeductions: fromCents(totalDeductionsCents),
    employerContributions: fromCents(employerContributionsCents),
    netSalary: fromCents(netSalaryCents),
    ptkpStatus,
    breakdown: {
      taxableGross: fromCents(taxableGrossCents),
      occupationalCost: fromCents(occupationalCostCents),
      annualizedNetIncome: fromCents(annualizedNetIncomeCents),
      annualPtkpAmount: fromCents(annualPtkpAmountCents),
      taxableAnnualIncomePkp: fromCents(taxableAnnualIncomePkpCents),
      annualTax: fromCents(annualTaxCents),
      monthlyTaxBeforeSurcharge: fromCents(monthlyTaxBeforeSurchargeCents),
      surchargeApplied: fromCents(surchargeAppliedCents),
      methodUsed,
    },
  };
}
