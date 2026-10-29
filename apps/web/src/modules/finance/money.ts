/**
 * Phase 6 — money presentation.
 *
 * Display formatting ONLY, and deliberately **string-based**. The backend is
 * authoritative for every amount, and this file never parses a money value
 * into a JavaScript number — not even to render it. Grouping separators are
 * inserted by text manipulation, so a figure shown on screen is always
 * exactly the figure the database holds.
 *
 * `Intl.NumberFormat` is avoided on purpose: it takes a `number`, which is
 * precisely the conversion this module exists to prevent.
 */

import { formatMoney } from "../../shared/format";
import type { Translate } from "../../i18n/LocaleProvider";

export { formatMoney } from "../../shared/format";

/** Amount with its currency, e.g. `IDR 1.250,75`. */
export function formatAmount(value: string | null | undefined, currency: string | null | undefined): string {
  const formatted = formatMoney(value);
  if (formatted === "—") return formatted;
  return currency ? `${currency} ${formatted}` : formatted;
}

/** A signed presentation of a transaction amount, by direction. */
export function formatSigned(value: string, direction: "income" | "expense", currency?: string | null): string {
  const sign = direction === "income" ? "+" : "−";
  return `${sign} ${formatAmount(value, currency)}`;
}

/** True when a string is a valid positive money amount the API will accept. */
export function isValidAmountInput(value: string): boolean {
  return /^\d{1,16}(\.\d{1,2})?$/.test(value.trim()) && /[1-9]/.test(value);
}

/** Four decimals, as open-item and budget routes accept. Zero is allowed here
 * because a budget weight or an allocation may legitimately be zero. */
export function isValidAmount4Input(value: string): boolean {
  return /^\d{1,16}(\.\d{1,4})?$/.test(value.trim());
}

/** The stored value stays the API's (`cash`, `bank`, `petty_cash`); only the
 *  word on screen is translated. An unknown type falls through as-is rather
 *  than inventing a label for a value this build does not know. */
export function accountTypeLabel(t: Translate, type: string): string {
  switch (type) {
    case "cash":
      return t("finAccounts.typeCash");
    case "bank":
      return t("finAccounts.typeBank");
    case "petty_cash":
      return t("finAccounts.typePettyCash");
    default:
      return type;
  }
}

/** First and last day of the month a date falls in, as YYYY-MM-DD. */
export function monthRange(reference = new Date()): { from: string; to: string } {
  const y = reference.getFullYear();
  const m = reference.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(y, m + 1, 0).getDate();
  return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(lastDay)}` };
}
