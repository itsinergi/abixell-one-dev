import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/domain/shared-kernel/errors.js";
import {
  allocateLandedCost,
  divideCostQuantity,
  fromExactUnits,
  mulRateUnits,
  multiplyQuantityCost,
  parseExactDecimalToScaledBigInt,
  roundScaledDivision,
  toExactUnits,
  toScaledRate,
} from "../src/modules/supply-chain/warehouse/domain/valuation-policy.js";

describe("WMS Valuation Policy — Exact Decimal & Scaled Integer Arithmetic", () => {
  describe("Unit conversion & exact decimal parsing", () => {
    it("converts standard 4-decimal currency amounts to exact scaled units and back", () => {
      const amount = 1250.7525;
      const units = toExactUnits(amount);
      expect(units).toBe(12507525n);
      expect(fromExactUnits(units)).toBe(1250.7525);
    });

    it("rejects amounts with exponential notation or excessive decimal precision", () => {
      expect(() => parseExactDecimalToScaledBigInt(1e-7, 10_000n, 4)).toThrow(ValidationError);
      expect(() => parseExactDecimalToScaledBigInt(10.123456, 10_000n, 4)).toThrow(ValidationError);
    });

    it("handles negative amounts correctly", () => {
      const units = toExactUnits(-500.25);
      expect(units).toBe(-5002500n);
      expect(fromExactUnits(units)).toBe(-500.25);
    });
  });

  describe("Scaled division and rounding modes", () => {
    it("rounds half_up deterministically", () => {
      // 5 / 2 = 2.5 -> rounds to 3
      expect(roundScaledDivision(5n, 2n, "half_up")).toBe(3n);
      // 4 / 2 = 2
      expect(roundScaledDivision(4n, 2n, "half_up")).toBe(2n);
      // -5 / 2 = -2.5 -> rounds to -3
      expect(roundScaledDivision(-5n, 2n, "half_up")).toBe(-3n);
    });

    it("rounds down (truncation towards zero) deterministically", () => {
      expect(roundScaledDivision(5n, 2n, "down")).toBe(2n);
      expect(roundScaledDivision(-5n, 2n, "down")).toBe(-2n);
    });

    it("rounds up (ceiling) deterministically", () => {
      expect(roundScaledDivision(5n, 2n, "up")).toBe(3n);
      expect(roundScaledDivision(-5n, 2n, "up")).toBe(-3n);
    });

    it("throws ValidationError on division by zero", () => {
      expect(() => roundScaledDivision(100n, 0n)).toThrow(ValidationError);
    });
  });

  describe("Quantity and unit cost multiplication & division", () => {
    it("multiplies quantity and unit cost without IEEE-754 floating point drift", () => {
      const qty = 33.3333;
      const unitCost = 12.3456;
      const total = multiplyQuantityCost(qty, unitCost);
      // 33.3333 * 12.3456 = 411.51958848 -> 4-decimal half_up = 411.5196
      expect(total).toBe(411.5196);
    });

    it("divides total cost by quantity with exact precision", () => {
      const totalCost = 1000.0;
      const qty = 3;
      const unitCost = divideCostQuantity(totalCost, qty);
      // 1000 / 3 = 333.3333333... -> 333.3333
      expect(unitCost).toBe(333.3333);
    });
  });

  describe("Landed Cost Allocation (Exact Total Conservation)", () => {
    it("allocates landed cost by value with exact sum conservation", () => {
      const totalLandedCost = 1500.0;
      const items = [
        { itemId: "item-1", quantity: 10, baseAmount: 2000.0 },
        { itemId: "item-2", quantity: 20, baseAmount: 3000.0 },
        { itemId: "item-3", quantity: 30, baseAmount: 5000.0 },
      ];

      const allocations = allocateLandedCost(totalLandedCost, items, "by_value");
      expect(allocations).toHaveLength(3);

      const sumAllocated = allocations.reduce((acc, cur) => acc + cur.allocatedAmount, 0);
      expect(sumAllocated).toBe(1500.0);

      // item-1 (20%): 300.0, per unit added = 300 / 10 = 30.0
      expect(allocations[0]?.allocatedAmount).toBe(300.0);
      expect(allocations[0]?.costPerUnitAdded).toBe(30.0);

      // item-2 (30%): 450.0, per unit added = 450 / 20 = 22.5
      expect(allocations[1]?.allocatedAmount).toBe(450.0);
      expect(allocations[1]?.costPerUnitAdded).toBe(22.5);

      // item-3 (50%): 750.0, per unit added = 750 / 30 = 25.0
      expect(allocations[2]?.allocatedAmount).toBe(750.0);
      expect(allocations[2]?.costPerUnitAdded).toBe(25.0);
    });

    it("allocates landed cost by quantity with exact conservation even with odd fractions", () => {
      const totalLandedCost = 100.0;
      const items = [
        { itemId: "item-1", quantity: 1, baseAmount: 10.0 },
        { itemId: "item-2", quantity: 1, baseAmount: 20.0 },
        { itemId: "item-3", quantity: 1, baseAmount: 30.0 },
      ];

      const allocations = allocateLandedCost(totalLandedCost, items, "by_quantity");
      expect(allocations).toHaveLength(3);

      // Total must be conserved down to 0.0000 exactly
      const sumAllocated = allocations.reduce((acc, cur) => acc + cur.allocatedAmount, 0);
      expect(sumAllocated).toBe(100.0);

      // 100 / 3 = 33.3333 for items 1 and 2, last item absorbs 33.3334
      expect(allocations[0]?.allocatedAmount).toBe(33.3333);
      expect(allocations[1]?.allocatedAmount).toBe(33.3333);
      expect(allocations[2]?.allocatedAmount).toBe(33.3334);
    });

    it("allocates landed cost by weight and equal allocation methods", () => {
      const totalLandedCost = 500.0;
      const items = [
        { itemId: "item-heavy", quantity: 5, baseAmount: 100.0, weight: 80 },
        { itemId: "item-light", quantity: 10, baseAmount: 100.0, weight: 20 },
      ];

      const byWeight = allocateLandedCost(totalLandedCost, items, "by_weight");
      expect(byWeight.reduce((acc, cur) => acc + cur.allocatedAmount, 0)).toBe(500.0);
      expect(byWeight[0]?.allocatedAmount).toBe(400.0);
      expect(byWeight[1]?.allocatedAmount).toBe(100.0);

      const equal = allocateLandedCost(totalLandedCost, items, "equal");
      expect(equal.reduce((acc, cur) => acc + cur.allocatedAmount, 0)).toBe(500.0);
      expect(equal[0]?.allocatedAmount).toBe(250.0);
      expect(equal[1]?.allocatedAmount).toBe(250.0);
    });
  });
});
