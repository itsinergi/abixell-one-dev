import { describe, expect, it } from "vitest";
import {
  allocateLandedCost,
  divideCostQuantity,
  fromExactUnits,
  multiplyQuantityCost,
  mulRateUnits,
  parseExactDecimalToScaledBigInt,
  RATE_SCALE,
  roundScaledDivision,
  toExactUnits,
  toScaledRate,
} from "./valuation-policy.js";
import { ValidationError } from "../../../../domain/shared-kernel/errors.js";

describe("Wave A5 — Supply Chain Valuation & Landed Cost Arithmetic Engine", () => {
  describe("parseExactDecimalToScaledBigInt & unit conversions", () => {
    it("parses and converts exact decimals without floating point drift", () => {
      const parsed = parseExactDecimalToScaledBigInt(1234.5678, 10_000n, 4);
      expect(parsed).toBe(12345678n);

      const exactUnits = toExactUnits(1234.5678);
      expect(exactUnits).toBe(12345678n);

      const num = fromExactUnits(exactUnits);
      expect(num).toBe(1234.5678);
    });

    it("handles negative numbers and zeroes properly", () => {
      const zero = toExactUnits(0);
      expect(zero).toBe(0n);
      expect(fromExactUnits(0n)).toBe(0);

      const neg = toExactUnits(-50.25);
      expect(neg).toBe(-502500n);
      expect(fromExactUnits(-502500n)).toBe(-50.25);
    });

    it("rejects non-finite and exponential numbers", () => {
      expect(() => parseExactDecimalToScaledBigInt(Number.NaN, 10_000n, 4)).toThrow(
        ValidationError,
      );
      expect(() => parseExactDecimalToScaledBigInt(Number.POSITIVE_INFINITY, 10_000n, 4)).toThrow(
        ValidationError,
      );
      expect(() => parseExactDecimalToScaledBigInt(1e-5, 10_000n, 4)).toThrow(
        ValidationError,
      );
    });

    it("rejects numbers exceeding max decimal scale", () => {
      expect(() => parseExactDecimalToScaledBigInt(10.12345, 10_000n, 4)).toThrow(
        ValidationError,
      );
    });
  });

  describe("mulRateUnits & roundScaledDivision", () => {
    it("performs exact rate multiplication with exact rounding modes", () => {
      const baseUnits = 10_000_000n; // 1,000.0000
      const rate = 0.05; // 5%
      const multiplied = mulRateUnits(baseUnits, rate, "half_up");
      expect(multiplied).toBe(500_000n); // 50.0000
    });

    it("performs exact division with half_up, up, down rounding", () => {
      const num = 10_000_000n; // 1,000.0000
      const div3HalfUp = roundScaledDivision(num, 3n, "half_up");
      const div3Down = roundScaledDivision(num, 3n, "down");
      const div3Up = roundScaledDivision(num, 3n, "up");

      expect(div3Down).toBe(3333333n);
      expect(div3HalfUp).toBe(3333333n);
      expect(div3Up).toBe(3333334n);
    });

    it("throws ValidationError on division by zero", () => {
      expect(() => roundScaledDivision(100n, 0n)).toThrow(ValidationError);
    });
  });

  describe("multiplyQuantityCost & divideCostQuantity", () => {
    it("multiplies quantity * unitCost with exact decimal arithmetic", () => {
      const total = multiplyQuantityCost(10, 15000.5);
      expect(total).toBe(150005);
    });

    it("divides totalCost / quantity with exact decimal arithmetic", () => {
      const unitCost = divideCostQuantity(150005, 10);
      expect(unitCost).toBe(15000.5);
    });

    it("rejects non-positive quantity in division", () => {
      expect(() => divideCostQuantity(1000, 0)).toThrow(ValidationError);
      expect(() => divideCostQuantity(1000, -5)).toThrow(ValidationError);
    });
  });

  describe("allocateLandedCost", () => {
    it("allocates landed cost by value with exact penny absorption on last item", () => {
      const items = [
        { itemId: "item-A", quantity: 10, baseAmount: 100000 }, // 10%
        { itemId: "item-B", quantity: 20, baseAmount: 300000 }, // 30%
        { itemId: "item-C", quantity: 30, baseAmount: 600000 }, // 60%
      ];

      const alloc = allocateLandedCost(50000, items, "by_value");

      expect(alloc).toHaveLength(3);
      expect(alloc[0].allocatedAmount).toBe(5000);
      expect(alloc[0].costPerUnitAdded).toBe(500); // 5,000 / 10

      expect(alloc[1].allocatedAmount).toBe(15000);
      expect(alloc[1].costPerUnitAdded).toBe(750); // 15,000 / 20

      expect(alloc[2].allocatedAmount).toBe(30000);
      expect(alloc[2].costPerUnitAdded).toBe(1000); // 30,000 / 30

      const sumAllocated = alloc.reduce((s, a) => s + a.allocatedAmount, 0);
      expect(sumAllocated).toBe(50000);
    });

    it("allocates landed cost by quantity with remainder absorbed cleanly", () => {
      const items = [
        { itemId: "item-A", quantity: 1, baseAmount: 1000 },
        { itemId: "item-B", quantity: 1, baseAmount: 1000 },
        { itemId: "item-C", quantity: 1, baseAmount: 1000 },
      ];

      const alloc = allocateLandedCost(100, items, "by_quantity");

      expect(alloc).toHaveLength(3);
      const sumAllocated = alloc.reduce((s, a) => s + a.allocatedAmount, 0);
      expect(sumAllocated).toBe(100);
      expect(alloc[0].allocatedAmount).toBe(33.3333);
      expect(alloc[1].allocatedAmount).toBe(33.3333);
      expect(alloc[2].allocatedAmount).toBe(33.3334);
    });

    it("allocates landed cost equally across items", () => {
      const items = [
        { itemId: "item-A", quantity: 10, baseAmount: 5000 },
        { itemId: "item-B", quantity: 20, baseAmount: 10000 },
      ];

      const alloc = allocateLandedCost(10000, items, "equal");

      expect(alloc[0].allocatedAmount).toBe(5000);
      expect(alloc[1].allocatedAmount).toBe(5000);
      expect(alloc[0].costPerUnitAdded).toBe(500); // 5000 / 10
      expect(alloc[1].costPerUnitAdded).toBe(250); // 5000 / 20
    });

    it("rejects non-positive total landed cost or empty items list", () => {
      expect(() => allocateLandedCost(0, [{ itemId: "A", quantity: 1, baseAmount: 100 }], "by_value")).toThrow(ValidationError);
      expect(() => allocateLandedCost(1000, [], "by_value")).toThrow(ValidationError);
    });
  });
});
