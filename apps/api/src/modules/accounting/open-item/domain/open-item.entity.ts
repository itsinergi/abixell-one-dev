/**
 * WP-FIN-A6-02 — AP/AR open-item settlement (ADR-0017).
 *
 * The open amount is never stored. It is a projection of `original_amount`
 * against the append-only allocation history, so historical aging at any
 * `asOfDate` stays reproducible (ADR-0017 §1–§2).
 */

export type OpenItemSide = "AR" | "AP";
export type OpenItemDirection = "debit" | "credit";
export type OpenItemSourceKind =
  | "invoice"
  | "payment"
  | "credit_note"
  | "debit_note"
  | "down_payment"
  | "withholding"
  | "unapplied";
export type OpenItemPartyType = "customer" | "supplier";

/**
 * Source tables whose rows may be turned into open items. Whitelisted so a
 * caller cannot point `source_ref_table` at an arbitrary relation.
 */
export const OPEN_ITEM_SOURCE_TABLES = [
  "scm_vendor_invoices",
  "scm_payment_lines",
  "customer_invoices",
] as const;
export type OpenItemSourceTable = (typeof OPEN_ITEM_SOURCE_TABLES)[number];

export interface OpenItem {
  id: string;
  tenantId: string;
  legalEntityId: string;
  side: OpenItemSide;
  direction: OpenItemDirection;
  sourceKind: OpenItemSourceKind;
  sourceRefTable: string;
  sourceRefId: string;
  partyType: OpenItemPartyType;
  partyId: string;
  documentNo: string;
  documentDate: string;
  dueDate: string | null;
  currency: string;
  originalAmount: string;
  createdBy: string | null;
  createdAt: string;
}

export interface OpenItemAllocation {
  id: string;
  tenantId: string;
  sourceOpenItemId: string;
  targetOpenItemId: string;
  amount: string;
  currency: string;
  allocationDate: string;
  idempotencyKey: string;
  reversesId: string | null;
  reversalReason: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface CreateOpenItemInput {
  tenantId: string;
  legalEntityId: string;
  side: OpenItemSide;
  direction: OpenItemDirection;
  sourceKind: OpenItemSourceKind;
  sourceRefTable: string;
  sourceRefId: string;
  partyType: OpenItemPartyType;
  partyId: string;
  documentNo: string;
  documentDate: string;
  dueDate: string | null;
  currency: string;
  originalAmount: string;
  createdBy: string | null;
}

export interface AllocateInput {
  tenantId: string;
  legalEntityId: string;
  /** Credit-direction instrument being applied. */
  sourceOpenItemId: string;
  /** Debit-direction instrument being settled. */
  targetOpenItemId: string;
  amount: string;
  allocationDate: string;
  idempotencyKey: string;
  createdBy: string | null;
}

export interface ReverseAllocationInput {
  tenantId: string;
  allocationId: string;
  reversalReason: string;
  createdBy: string | null;
}

export interface AgingBucket {
  label: string;
  /** Inclusive lower bound in days overdue; negative is not yet due. */
  fromDays: number;
  toDays: number | null;
  amount: string;
  itemCount: number;
}

export interface AgingResult {
  asOfDate: string;
  side: OpenItemSide;
  currency: string;
  totalOpen: string;
  buckets: AgingBucket[];
}

export interface OpenItemWithRemaining extends OpenItem {
  allocatedAmount: string;
  remainingAmount: string;
}

// --- Exact decimal at the source document's precision (4 places) -------------
//
// Source documents are numeric(18,4) (`scm_vendor_invoices.invoice_amount`,
// `customer_invoices.total_amount`). Projecting at 2 places would round the
// remaining balance away from the invoice it came from.

export const AMOUNT_SCALE = 4n;
export const AMOUNT_FACTOR = 10000n;

/** Exact 4-decimal magnitude. Returns null for anything malformed. */
export function toUnits(value: string): bigint | null {
  const raw = (value ?? "").trim();
  if (!/^\d{1,16}(\.\d{1,4})?$/.test(raw)) return null;
  const [whole, frac = ""] = raw.split(".");
  return BigInt(whole) * AMOUNT_FACTOR + BigInt(frac.padEnd(4, "0"));
}

export function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / AMOUNT_FACTOR;
  const frac = (abs % AMOUNT_FACTOR).toString().padStart(4, "0");
  return (negative ? "-" : "") + whole.toString() + "." + frac;
}

export function addAmounts(a: string, b: string): string | null {
  const au = toUnits(a);
  const bu = toUnits(b);
  if (au === null || bu === null) return null;
  return fromUnits(au + bu);
}

export function subtractAmounts(a: string, b: string): string | null {
  const au = toUnits(a);
  const bu = toUnits(b);
  if (au === null || bu === null) return null;
  return fromUnits(au - bu);
}

/**
 * Signed open amount for one item: a debit-direction item still owes, a
 * credit-direction item still has unapplied value. Allocations always net a
 * credit against a debit on the same side, so `allocated` is the sum of that
 * item's allocation amounts on either side.
 */
export function projectRemaining(originalAmount: string, allocated: string): string | null {
  return subtractAmounts(originalAmount, allocated);
}

/**
 * Days overdue as of `asOfDate`, floor semantics on calendar dates. Negative
 * means not yet due; an item with no due date never ages and is reported
 * outside the buckets.
 */
export function daysOverdue(dueDate: string, asOfDate: string): number | null {
  if (!dueDate) return null;
  const due = Date.parse(dueDate + "T00:00:00Z");
  const asOf = Date.parse(asOfDate + "T00:00:00Z");
  if (Number.isNaN(due) || Number.isNaN(asOf)) return null;
  return Math.floor((asOf - due) / 86400000);
}

/**
 * Default aging layout (presentation policy only — the open-item history is
 * independent of it, ADR-0017 §2). Configurable per tenant later without
 * touching settlement.
 */
export const DEFAULT_AGING_BUCKETS: ReadonlyArray<{ label: string; fromDays: number; toDays: number | null }> = [
  { label: "not_due", fromDays: Number.NEGATIVE_INFINITY, toDays: -1 },
  { label: "1-30", fromDays: 0, toDays: 30 },
  { label: "31-60", fromDays: 31, toDays: 60 },
  { label: "61-90", fromDays: 61, toDays: 90 },
  { label: "90+", fromDays: 91, toDays: null },
];
