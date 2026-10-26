/**
 * HSE Advanced — the small amount of arithmetic the module owns.
 *
 * Two computations live here and nowhere else:
 *
 * 1. **Breach evaluation** (HSE-ADV-005). A reading is compared to the point's
 *    thresholds as they stand at write time. The comparison is exact-decimal:
 *    `NUMERIC(20,4)` arrives as text and is parsed to a scaled integer, so a
 *    reading of 0.1 + 0.2 can never cross a threshold by float error.
 *
 * 2. **Indicator rates** (HSE-ADV-007). Rates are derived from counts and an
 *    exposure-hours denominator, rounded half-away-from-zero at four decimals.
 *    A null denominator yields null rather than a rate over an invented base.
 *
 * Nothing here reads or writes state; the services own persistence.
 */

const DECIMAL_4DP = /^-?\d{1,16}(\.\d{1,4})?$/;

/** Parse a 4-decimal numeric string to a scaled integer (1 unit = 10000). */
export function toScaled4(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!DECIMAL_4DP.test(text)) return null;
  const negative = text.startsWith("-");
  const [whole, frac = ""] = (negative ? text.slice(1) : text).split(".");
  const scaled = BigInt(whole) * 10000n + BigInt((frac + "0000").slice(0, 4));
  return negative ? -scaled : scaled;
}

export function fromScaled4(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  return `${negative ? "-" : ""}${abs / 10000n}.${(abs % 10000n).toString().padStart(4, "0")}`;
}

/**
 * Is this reading outside the point's limits?
 *
 * A null threshold means that side is unbounded, so a point with only a maximum
 * reports a breach above it and never below anything. A point with no threshold
 * at all can never breach — which is honest: nothing was declared to breach.
 * An unparseable value is a breach, because a measurement nobody can interpret
 * must not be recorded as compliant.
 */
export function isThresholdBreach(
  value: string,
  thresholdMin: string | null,
  thresholdMax: string | null,
): boolean {
  const measured = toScaled4(value);
  if (measured === null) return true;
  const min = toScaled4(thresholdMin);
  const max = toScaled4(thresholdMax);
  if (min !== null && measured < min) return true;
  if (max !== null && measured > max) return true;
  return false;
}

/**
 * Divide a count by an exposure denominator and express the result per
 * `baseHours` worked hours, to four decimals. Returns null when the denominator
 * is absent or zero — a rate over no hours is not a number, and reporting 0
 * would read as "no incidents" instead of "no denominator".
 */
export function ratePerHours(
  numerator: number,
  exposureHours: string | null,
  baseHours: number,
): string | null {
  if (exposureHours === null) return null;
  const hours = toScaled4(exposureHours);
  if (hours === null || hours <= 0n) return null;
  // `hours` is already scaled by 10000, so the result needs 10000 twice to
  // come back out at 4 decimal places — scaling it once would report a rate
  // ten-thousand times too small.
  const scaled = divideRounded(BigInt(numerator) * BigInt(baseHours) * 10000n * 10000n, hours);
  return fromScaled4(scaled);
}

/**
 * A plain ratio (closed / opened) to four decimals. Null when nothing was
 * opened: an empty set has no closure rate, and 0% would misreport it.
 */
export function closureRate(closed: number, opened: number): string | null {
  if (opened <= 0) return null;
  return fromScaled4(divideRounded(BigInt(closed) * 10000n, BigInt(opened)));
}

/** Integer division rounding half away from zero. */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twiceAbsRemainder = (remainder < 0n ? -remainder : remainder) * 2n;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  if (twiceAbsRemainder >= absDenominator) {
    return quotient + (numerator < 0n ? -1n : 1n);
  }
  return quotient;
}
