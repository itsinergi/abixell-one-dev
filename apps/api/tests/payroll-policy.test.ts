import { describe, expect, it } from "vitest";
import {
  calculateEmployeePayroll,
  divCents,
  fromCents,
  mulRateCents,
  toCents,
} from "../src/modules/workforce/advanced/domain/payroll-policy.js";
import type { WorkforceStatutoryPolicy } from "../src/modules/workforce/advanced/domain/workforce-advanced.entity.js";

const policy: WorkforceStatutoryPolicy = {
  id: "policy-test",
  tenantId: "tenant-test",
  policyCode: "ID-STATUTORY-TEST",
  name: "Indonesia Statutory Test Policy",
  countryCode: "ID",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  bpjsKesehatanRateEmployer: 0.04,
  bpjsKesehatanRateEmployee: 0.01,
  bpjsKesehatanCap: 12_000_000,
  bpjsTkJhtRateEmployer: 0.037,
  bpjsTkJhtRateEmployee: 0.02,
  bpjsTkJkkRate: 0.0024,
  bpjsTkJkmRate: 0.003,
  bpjsTkJpRateEmployer: 0.02,
  bpjsTkJpRateEmployee: 0.01,
  bpjsTkJpCap: 10_042_300,
  occupationalCostRate: 0.05,
  occupationalCostMonthlyCap: 500_000,
  ptkpAnnualAmounts: {},
  pph21Brackets: [],
  pph21TerBrackets: [],
  pph21Method: "annualized",
  nonNpwpSurchargeRate: 0.2,
  roundingMode: "half_up",
  isActive: true,
};

describe("Workforce Advanced payroll policy fixed-point arithmetic", () => {
  it("calculates recurring overtime hourly division and fractional hours in exact cents", () => {
    const statutoryWageBaseCents = toCents(17_000_000);
    const hourlyRateCents = divCents(statutoryWageBaseCents, 173, "half_up");

    const nativeFloatOvertime = (17_000_000 / 173) * 4.75;
    expect(Number.isInteger(nativeFloatOvertime * 100)).toBe(false);

    expect(fromCents(hourlyRateCents)).toBe(98_265.9);
    expect(fromCents(mulRateCents(hourlyRateCents, 4.75, "half_up"))).toBe(466_763.03);
  });

  it("keeps authoritative payroll components and totals on fixed cents", () => {
    const result = calculateEmployeePayroll({
      baseSalary: 15_000_000,
      fixedAllowance: 2_000_000,
      overtimeHours: 4.75,
      ptkpStatus: "TK/0",
      hasNpwp: true,
      policy,
    });

    expect(result.overtimePay).toBe(466_763.03);
    expect(result.grossSalary).toBe(17_466_763.03);
    expect(result.bpjsKesehatanEmployer).toBe(480_000);
    expect(result.bpjsKesehatanEmployee).toBe(120_000);
    expect(result.bpjsTkJhtEmployee).toBe(340_000);
    expect(result.bpjsTkJhtEmployer).toBe(629_000);
    expect(result.bpjsTkJkkEmployer).toBe(40_800);
    expect(result.bpjsTkJkmEmployer).toBe(51_000);
    expect(result.bpjsTkJPSEmployee).toBe(100_423);
    expect(result.bpjsTkJPSEmployer).toBe(200_846);
    expect(toCents(result.totalDeductions)).toBe(
      toCents(result.bpjsKesehatanEmployee) +
        toCents(result.bpjsTkJhtEmployee) +
        toCents(result.bpjsTkJPSEmployee) +
        toCents(result.pph21Withheld) +
        toCents(result.otherDeductions),
    );
    expect(toCents(result.netSalary)).toBe(
      toCents(result.grossSalary) - toCents(result.totalDeductions),
    );
    expect(fromCents(toCents(result.overtimePay))).toBe(result.overtimePay);
    expect(fromCents(toCents(result.netSalary))).toBe(result.netSalary);
  });
});
