/**
 * Warehouse Management (WMS) — Valuation & Landed Cost Arithmetic Engine (SCM-ADV-005).
 *
 * Exact-decimal, stateless calculation engine for FIFO inventory valuation
 * and landed cost voucher allocation (by value, quantity, weight, equal).
 *
 * Rules:
 * - Pure functions with zero side-effects.
 * - Strict scaled-integer cents / fixed-point arithmetic via `bigint`.
 * - Zero authoritative IEEE-754 binary floating point arithmetic.
 */

import { ValidationError } from "../../../../domain/shared-kernel/errors.js";

export type RoundingMode = "half_up" | "down" | "up";

export const RATE_SCALE = 1_000_000n;
const MONETARY_SCALE = 4; // SCM amounts track 4 decimal places
const RATE_DECIMAL_SCALE = 6;

/**
 * Parses a finite JavaScript `number` into an exact scaled `bigint` using
 * string-decimal decomposition.
 */
export function parseExactDecimalToScaledBigInt(
  value: number,
  scale: bigint,
  maxScale: number,
  fieldName = "amount",
): bigint {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError(`${fieldName} must be a finite number`);
  }

  const raw = value.toString();
  if (raw.includes("e") || raw.includes("E")) {
    throw new ValidationError(
      `${fieldName} must be expressed as a standard decimal number without exponential notation`,
    );
  }

  const isNegative = raw.startsWith("-");
  const unsigned = isNegative ? raw.slice(1) : raw;
  const [integerPart, fractionalPart = ""] = unsigned.split(".");

  if (fractionalPart.length > maxScale) {
    throw new ValidationError(
      `${fieldName} carries ${fractionalPart.length} decimal places, exceeding the allowed precision of ${maxScale}`,
    );
  }

  const paddedFraction = fractionalPart.padEnd(maxScale, "0");
  const wholeUnits = BigInt(integerPart || "0");
  const fractionalUnits = BigInt(paddedFraction || "0");

  let parsed = wholeUnits * scale + fractionalUnits;
  if (isNegative) {
    parsed = -parsed;
  }
  return parsed;
}

/**
 * Converts a standard 4-decimal monetary amount to scaled BigInt.
 */
export function toExactUnits(amount: number, fieldName = "amount"): bigint {
  return parseExactDecimalToScaledBigInt(amount, 10_000n, MONETARY_SCALE, fieldName);
}

/**
 * Converts scaled BigInt back to standard JS number (divided by 10,000).
 */
export function fromExactUnits(units: bigint): number {
  const isNegative = units < 0n;
  const abs = isNegative ? -units : units;
  const whole = abs / 10_000n;
  const frac = abs % 10_000n;
  const num = Number(whole) + Number(frac) / 10_000;
  return isNegative ? -num : num;
}

/**
 * Converts a decimal rate (e.g. 0.05) to a scaled integer representation.
 */
export function toScaledRate(rate: number, fieldName = "rate"): bigint {
  return parseExactDecimalToScaledRate(rate, RATE_SCALE, RATE_DECIMAL_SCALE, fieldName);
}

function parseExactDecimalToScaledRate(
  value: number,
  scale: bigint,
  maxScale: number,
  fieldName = "rate",
): bigint {
  return parseExactDecimalToScaledBigInt(value, scale, maxScale, fieldName);
}

/**
 * Performs integer division on scaled amounts with deterministic rounding.
 */
export function roundScaledDivision(
  numerator: bigint,
  divisor: bigint,
  mode: RoundingMode = "half_up",
): bigint {
  if (divisor === 0n) {
    throw new ValidationError("Division by zero in valuation calculation");
  }

  const isNegative = (numerator < 0n) !== (divisor < 0n);
  const num = numerator < 0n ? -numerator : numerator;
  const den = divisor < 0n ? -divisor : divisor;

  const quotient = num / den;
  const remainder = num % den;

  if (remainder === 0n) {
    return isNegative ? -quotient : quotient;
  }

  let rounded = quotient;
  if (mode === "down") {
    rounded = quotient;
  } else if (mode === "up") {
    rounded = quotient + 1n;
  } else {
    // "half_up"
    const doubleRemainder = remainder * 2n;
    if (doubleRemainder >= den) {
      rounded = quotient + 1n;
    }
  }

  return isNegative ? -rounded : rounded;
}

/**
 * Multiplies an exact unit amount by a rate with exact scaled division.
 */
export function mulRateUnits(
  amountUnits: bigint,
  rate: number,
  mode: RoundingMode = "half_up",
): bigint {
  const scaledRate = toScaledRate(rate);
  return roundScaledDivision(amountUnits * scaledRate, RATE_SCALE, mode);
}

/**
 * Multiplies quantity * unitCost with exact decimal arithmetic.
 */
export function multiplyQuantityCost(
  quantity: number,
  unitCost: number,
  mode: RoundingMode = "half_up",
): number {
  const qtyUnits = toExactUnits(quantity, "quantity");
  const costUnits = toExactUnits(unitCost, "unitCost");
  const total = roundScaledDivision(qtyUnits * costUnits, 10_000n, mode);
  return fromExactUnits(total);
}

/**
 * Divides totalCost / quantity to get unitCost with exact decimal arithmetic.
 */
export function divideCostQuantity(
  totalCost: number,
  quantity: number,
  mode: RoundingMode = "half_up",
): number {
  if (quantity <= 0) {
    throw new ValidationError("Quantity must be positive for unit cost division");
  }
  const totalUnits = toExactUnits(totalCost, "totalCost");
  const qtyUnits = toExactUnits(quantity, "quantity");
  const unitCost = roundScaledDivision(totalUnits * 10_000n, qtyUnits, mode);
  return fromExactUnits(unitCost);
}

export interface LandedCostItemInput {
  itemId: string;
  quantity: number;
  baseAmount: number;
  weight?: number;
}

export interface AllocatedLandedCostItem {
  itemId: string;
  allocatedAmount: number;
  costPerUnitAdded: number;
}

/**
 * Allocates landed cost vouchers across multiple items deterministically using exact arithmetic.
 * Ensures the sum of allocated amounts equals the total landed cost exactly (no rounding leaks).
 */
export function allocateLandedCost(
  totalLandedCost: number,
  items: LandedCostItemInput[],
  method: "by_value" | "by_quantity" | "by_weight" | "equal",
): AllocatedLandedCostItem[] {
  if (totalLandedCost <= 0) {
    throw new ValidationError("Total landed cost must be positive");
  }
  if (!items.length) {
    throw new ValidationError("At least one item is required for landed cost allocation");
  }

  const totalCostUnits = toExactUnits(totalLandedCost, "totalLandedCost");
  let basisTotal = 0n;

  const itemBases = items.map((item) => {
    if ((item.baseAmount ?? 0) < 0 || (item.quantity ?? 0) < 0 || (item.weight ?? 0) < 0) {
      throw new ValidationError("Allocation basis inputs must be non-negative");
    }
    let basis = 0n;
    if (method === "by_value") {
      basis = toExactUnits(item.baseAmount, "baseAmount");
    } else if (method === "by_quantity") {
      basis = toExactUnits(item.quantity, "quantity");
    } else if (method === "by_weight") {
      basis = toExactUnits(item.weight || 1, "weight");
    } else {
      basis = 10_000n; // equal basis per item
    }
    basisTotal += basis;
    return { item, basis };
  });

  if (basisTotal <= 0n) {
    throw new ValidationError("Total allocation basis must be positive");
  }

  let allocatedSum = 0n;
  const results: AllocatedLandedCostItem[] = [];

  for (let i = 0; i < itemBases.length; i++) {
    const { item, basis } = itemBases[i]!;
    let allocatedUnits: bigint;

    if (i === itemBases.length - 1) {
      // Last item absorbs any rounding remainder to ensure exact conservation
      allocatedUnits = totalCostUnits - allocatedSum;
    } else {
      allocatedUnits = roundScaledDivision(totalCostUnits * basis, basisTotal, "half_up");
      allocatedSum += allocatedUnits;
    }

    const allocatedAmount = fromExactUnits(allocatedUnits);
    const costPerUnitAdded = item.quantity > 0
      ? divideCostQuantity(allocatedAmount, item.quantity)
      : 0;

    results.push({
      itemId: item.itemId,
      allocatedAmount,
      costPerUnitAdded,
    });
  }

  return results;
}
