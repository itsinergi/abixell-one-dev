import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/domain/shared-kernel/errors.js";
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

  describe("Exact-decimal boundary review, scale enforcement, and fail-closed validation", () => {
    it("converts exact two-decimal monetary amounts to cents without floating drift", () => {
      expect(toCents(0)).toBe(0n);
      expect(toCents(0.0)).toBe(0n);
      expect(toCents(0.29)).toBe(29n);
      expect(toCents(1.05)).toBe(105n);
      expect(toCents(17.5)).toBe(1750n);
      expect(toCents(1234567.89)).toBe(123456789n);
      expect(toCents(-15.5)).toBe(-1550n);
      expect(toCents(-0.29)).toBe(-29n);

      expect(fromCents(29n)).toBe(0.29);
      expect(fromCents(105n)).toBe(1.05);
      expect(fromCents(-1550n)).toBe(-15.5);
    });

    it("fails closed on excessive monetary scale (>2 decimal places) instead of silently misrounding", () => {
      // 1.005 and 17.005 would produce native float drift under Math.round(val * 100)
      expect(() => toCents(1.005)).toThrow(ValidationError);
      expect(() => toCents(17.005)).toThrow(ValidationError);
      expect(() => toCents(0.001)).toThrow(ValidationError);
      expect(() => toCents(99.999)).toThrow(ValidationError);
    });

    it("fails closed on non-finite, NaN, and exponential monetary inputs", () => {
      expect(() => toCents(NaN)).toThrow(ValidationError);
      expect(() => toCents(Infinity)).toThrow(ValidationError);
      expect(() => toCents(-Infinity)).toThrow(ValidationError);
      expect(() => toCents(1e-7)).toThrow(ValidationError);
      expect(() => toCents(1e21)).toThrow(ValidationError);
    });

    it("multiplies exact statutory rates and quantities with deterministic rounding", () => {
      const baseCents = 10_000_000_00n; // IDR 10,000,000.00 in cents

      // 4% employer health
      expect(mulRateCents(baseCents, 0.04, "half_up")).toBe(400_000_00n);
      // 0.24% JKK
      expect(mulRateCents(baseCents, 0.0024, "half_up")).toBe(24_000_00n);
      // Zero multiplier and zero amount
      expect(mulRateCents(baseCents, 0, "half_up")).toBe(0n);
      expect(mulRateCents(0n, 0.04, "half_up")).toBe(0n);

      // Fractional overtime hours (e.g. 4.75 hours)
      const hourlyRateCents = 98_265_90n; // IDR 98,265.90
      expect(mulRateCents(hourlyRateCents, 4.75, "half_up")).toBe(466_763_03n);
      expect(mulRateCents(hourlyRateCents, 4.75, "down")).toBe(466_763_02n);
      expect(mulRateCents(hourlyRateCents, 4.75, "up")).toBe(466_763_03n);
    });

    it("fails closed on non-finite, excessive-scale, or invalid rate multipliers and divisors", () => {
      const baseCents = 1_000_000_00n;

      expect(() => mulRateCents(baseCents, NaN)).toThrow(ValidationError);
      expect(() => mulRateCents(baseCents, Infinity)).toThrow(ValidationError);
      expect(() => mulRateCents(baseCents, 0.0000001)).toThrow(ValidationError); // >6 decimal places

      expect(() => divCents(baseCents, 0)).toThrow(ValidationError);
      expect(() => divCents(baseCents, NaN)).toThrow(ValidationError);
      expect(() => divCents(baseCents, Infinity)).toThrow(ValidationError);
      expect(() => divCents(baseCents, 0.0000001)).toThrow(ValidationError);
    });
  });
});
