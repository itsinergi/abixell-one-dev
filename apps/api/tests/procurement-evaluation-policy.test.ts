import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/domain/shared-kernel/errors.js";
import {
  computeSupplierEvaluationScore,
  DEFAULT_EVALUATION_WEIGHTS,
  determineRatingGrade,
} from "../src/modules/supply-chain/procurement/domain/evaluation-policy.js";

describe("Procurement Evaluation Policy — Deterministic Supplier Scoring & Grade", () => {
  describe("Grade determination mapping", () => {
    it("maps scores to correct rating grades (A through E)", () => {
      expect(determineRatingGrade(95)).toBe("A");
      expect(determineRatingGrade(90)).toBe("A");
      expect(determineRatingGrade(89.99)).toBe("B");
      expect(determineRatingGrade(80)).toBe("B");
      expect(determineRatingGrade(75)).toBe("C");
      expect(determineRatingGrade(70)).toBe("C");
      expect(determineRatingGrade(65)).toBe("D");
      expect(determineRatingGrade(60)).toBe("D");
      expect(determineRatingGrade(59.99)).toBe("E");
      expect(determineRatingGrade(0)).toBe("E");
    });
  });

  describe("Score computation with default weights (Quality 35%, Delivery 30%, Pricing 20%, Service 15%)", () => {
    it("calculates 100% total score and Grade A for perfect scores", () => {
      const result = computeSupplierEvaluationScore({
        qualityScore: 100,
        deliveryScore: 100,
        pricingScore: 100,
        serviceScore: 100,
      });

      expect(result.totalScore).toBe(100);
      expect(result.ratingGrade).toBe("A");
      expect(result.breakdown.weightedQuality).toBe(35);
      expect(result.breakdown.weightedDelivery).toBe(30);
      expect(result.breakdown.weightedPricing).toBe(20);
      expect(result.breakdown.weightedService).toBe(15);
    });

    it("calculates accurate weighted score with fractional components", () => {
      // Quality: 85 * 0.35 = 29.75
      // Delivery: 90 * 0.30 = 27.00
      // Pricing: 75 * 0.20 = 15.00
      // Service: 80 * 0.15 = 12.00
      // Total: 29.75 + 27.00 + 15.00 + 12.00 = 83.75 -> Grade B
      const result = computeSupplierEvaluationScore({
        qualityScore: 85,
        deliveryScore: 90,
        pricingScore: 75,
        serviceScore: 80,
      });

      expect(result.totalScore).toBe(83.75);
      expect(result.ratingGrade).toBe("B");
      expect(result.breakdown.weightedQuality).toBe(29.75);
      expect(result.breakdown.weightedDelivery).toBe(27);
      expect(result.breakdown.weightedPricing).toBe(15);
      expect(result.breakdown.weightedService).toBe(12);
    });

    it("calculates Grade C, D, and E correctly based on weighted score thresholds", () => {
      // Quality: 70 * 0.35 = 24.5
      // Delivery: 75 * 0.30 = 22.5
      // Pricing: 70 * 0.20 = 14.0
      // Service: 70 * 0.15 = 10.5
      // Total = 71.5 -> Grade C
      const resultC = computeSupplierEvaluationScore({
        qualityScore: 70,
        deliveryScore: 75,
        pricingScore: 70,
        serviceScore: 70,
      });
      expect(resultC.totalScore).toBe(71.5);
      expect(resultC.ratingGrade).toBe("C");

      // Total < 60 -> Grade E
      const resultE = computeSupplierEvaluationScore({
        qualityScore: 50,
        deliveryScore: 50,
        pricingScore: 50,
        serviceScore: 50,
      });
      expect(resultE.totalScore).toBe(50);
      expect(resultE.ratingGrade).toBe("E");
    });
  });

  describe("Validation and custom weight configurations", () => {
    it("supports custom valid weights", () => {
      const customWeights = {
        quality: 0.4,
        delivery: 0.4,
        pricing: 0.1,
        service: 0.1,
      };
      const result = computeSupplierEvaluationScore(
        {
          qualityScore: 90,
          deliveryScore: 90,
          pricingScore: 80,
          serviceScore: 80,
        },
        customWeights,
      );

      // (90 * 0.4) + (90 * 0.4) + (80 * 0.1) + (80 * 0.1) = 36 + 36 + 8 + 8 = 88 -> Grade B
      expect(result.totalScore).toBe(88);
      expect(result.ratingGrade).toBe("B");
    });

    it("rejects weights that do not sum to 1.0", () => {
      expect(() =>
        computeSupplierEvaluationScore(
          { qualityScore: 80, deliveryScore: 80, pricingScore: 80, serviceScore: 80 },
          { quality: 0.5, delivery: 0.5, pricing: 0.2, service: 0.1 },
        ),
      ).toThrow(ValidationError);
    });

    it("rejects scores outside 0 - 100 range or non-finite values", () => {
      expect(() =>
        computeSupplierEvaluationScore({
          qualityScore: -5,
          deliveryScore: 80,
          pricingScore: 80,
          serviceScore: 80,
        }),
      ).toThrow(ValidationError);

      expect(() =>
        computeSupplierEvaluationScore({
          qualityScore: 105,
          deliveryScore: 80,
          pricingScore: 80,
          serviceScore: 80,
        }),
      ).toThrow(ValidationError);

      expect(() =>
        computeSupplierEvaluationScore({
          qualityScore: Number.NaN,
          deliveryScore: 80,
          pricingScore: 80,
          serviceScore: 80,
        }),
      ).toThrow(ValidationError);
    });
  });
});
