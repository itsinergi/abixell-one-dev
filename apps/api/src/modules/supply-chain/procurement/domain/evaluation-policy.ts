import { ValidationError } from "../../../../domain/shared-kernel/errors.js";
import type { ScmSupplierRatingGrade } from "./index.js";

/**
 * Standard supplier evaluation criteria weights.
 * Quality (35%), Delivery (30%), Pricing (20%), Service (15%) -> Total 100%
 */
export interface EvaluationWeights {
  quality: number; // e.g. 0.35
  delivery: number; // e.g. 0.30
  pricing: number; // e.g. 0.20
  service: number; // e.g. 0.15
}

export const DEFAULT_EVALUATION_WEIGHTS: Readonly<EvaluationWeights> = Object.freeze({
  quality: 0.35,
  delivery: 0.30,
  pricing: 0.20,
  service: 0.15,
});

export interface SupplierCategoryScores {
  qualityScore: number;
  deliveryScore: number;
  pricingScore: number;
  serviceScore: number;
}

export interface SupplierEvaluationResult {
  totalScore: number;
  ratingGrade: ScmSupplierRatingGrade;
  breakdown: {
    weightedQuality: number;
    weightedDelivery: number;
    weightedPricing: number;
    weightedService: number;
  };
}

/**
 * Scaled integer factor: 10,000 for 4 decimal places.
 */
const SCALE = 10_000n;

/**
 * Deterministically computes the weighted total score and rating grade for a supplier evaluation
 * using exact integer arithmetic to avoid IEEE-754 floating-point inaccuracies.
 */
export function computeSupplierEvaluationScore(
  scores: SupplierCategoryScores,
  weights: EvaluationWeights = DEFAULT_EVALUATION_WEIGHTS,
): SupplierEvaluationResult {
  validateScoreRange("qualityScore", scores.qualityScore);
  validateScoreRange("deliveryScore", scores.deliveryScore);
  validateScoreRange("pricingScore", scores.pricingScore);
  validateScoreRange("serviceScore", scores.serviceScore);

  // Validate weights sum to ~1.00 (within 0.0001 tolerance)
  const weightSum = weights.quality + weights.delivery + weights.pricing + weights.service;
  if (Math.abs(weightSum - 1.0) > 0.0001) {
    throw new ValidationError(`Evaluation weights must sum to 1.0 (100%), got ${weightSum}`);
  }

  // Convert each component to scaled BigInt
  const qScoreScaled = toScaled(scores.qualityScore);
  const dScoreScaled = toScaled(scores.deliveryScore);
  const pScoreScaled = toScaled(scores.pricingScore);
  const sScoreScaled = toScaled(scores.serviceScore);

  const qWeightScaled = toScaled(weights.quality);
  const dWeightScaled = toScaled(weights.delivery);
  const pWeightScaled = toScaled(weights.pricing);
  const sWeightScaled = toScaled(weights.service);

  // Weighted score = (score * weight) / SCALE
  const wQualityScaled = (qScoreScaled * qWeightScaled + SCALE / 2n) / SCALE;
  const wDeliveryScaled = (dScoreScaled * dWeightScaled + SCALE / 2n) / SCALE;
  const wPricingScaled = (pScoreScaled * pWeightScaled + SCALE / 2n) / SCALE;
  const wServiceScaled = (sScoreScaled * sWeightScaled + SCALE / 2n) / SCALE;

  const totalScoreScaled = wQualityScaled + wDeliveryScaled + wPricingScaled + wServiceScaled;
  const totalScore = fromScaled(totalScoreScaled);

  const ratingGrade = determineRatingGrade(totalScore);

  return {
    totalScore,
    ratingGrade,
    breakdown: {
      weightedQuality: fromScaled(wQualityScaled),
      weightedDelivery: fromScaled(wDeliveryScaled),
      weightedPricing: fromScaled(wPricingScaled),
      weightedService: fromScaled(wServiceScaled),
    },
  };
}

/**
 * Maps a total score (0 - 100) to standard supplier rating grade.
 * - A: >= 90.00 (Preferred Partner)
 * - B: >= 80.00 (Standard Approved)
 * - C: >= 70.00 (Conditional / Under Monitoring)
 * - D: >= 60.00 (Poor / Remedial Plan Required)
 * - E: < 60.00  (Unacceptable / Disqualified)
 */
export function determineRatingGrade(totalScore: number): ScmSupplierRatingGrade {
  if (totalScore >= 90.0) {
    return "A";
  }
  if (totalScore >= 80.0) {
    return "B";
  }
  if (totalScore >= 70.0) {
    return "C";
  }
  if (totalScore >= 60.0) {
    return "D";
  }
  return "E";
}

function validateScoreRange(field: string, score: number): void {
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new ValidationError(`${field} must be a finite number between 0 and 100, got ${score}`);
  }
}

function toScaled(val: number): bigint {
  return BigInt(Math.round(val * Number(SCALE)));
}

function fromScaled(val: bigint): number {
  return Number(val) / Number(SCALE);
}
