/**
 * WP-FIN-A6-04 — Bank reconciliation (ADR-0018).
 *
 * Two balances live here and neither may quietly become the other:
 * book movement is derived from the Accounting Kernel's GL facts, statement
 * movement from imported statement facts. The reconciliation reports both and
 * their difference; it never writes one over the other.
 *
 * Money is exact 2-decimal integer cents (`numeric(18,2)` on both sides —
 * statement lines and `general_ledger_entries` alike). Comparing a 4-decimal
 * statement amount against a 2-decimal ledger amount would produce permanent
 * false mismatches, so the statement side is held to the ledger's precision.
 */

import { createHash } from "node:crypto";

export type ReconciliationPolicy = "manual" | "suggested";
export type StatementDirection = "debit" | "credit";
export type DuplicateStatus = "accepted" | "review_queue";
export type ReconciliationStatus = "open" | "closed";
export type MatchKind = "manual" | "confirmed";

export const RECONCILIATION_POLICIES: ReconciliationPolicy[] = ["manual", "suggested"];
export const MATCH_KINDS: MatchKind[] = ["manual", "confirmed"];

/** Wave A6 imports CSV only; MT940/CAMT are separate adapters behind the
 *  `BankTransactionImporter` port, pending a compatibility and security
 *  review (ADR-0018 §2). */
export const SUPPORTED_FORMAT_PROFILES = ["csv_v1"] as const;
export type FormatProfile = (typeof SUPPORTED_FORMAT_PROFILES)[number];

/** Columns `csv_v1` requires. Everything else is optional and read when present. */
export const CSV_V1_REQUIRED_COLUMNS = ["value_date", "amount"] as const;

export interface BankAccount {
  id: string;
  tenantId: string;
  legalEntityId: string;
  bankName: string;
  houseBankCode: string;
  bankAccountId: string;
  accountNumberMasked: string;
  name: string;
  currency: string;
  /** The authorized GL account this statement is measured against. */
  ledgerAccountId: string;
  reconciliationPolicy: ReconciliationPolicy;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
}

export interface BankStatementImport {
  id: string;
  tenantId: string;
  bankAccountId: string;
  formatProfile: string;
  sourceFileName: string;
  importHash: string;
  lineCount: number;
  duplicateLineCount: number;
  importedBy: string | null;
  createdAt: string;
}

export interface BankStatementLine {
  id: string;
  tenantId: string;
  importId: string;
  bankAccountId: string;
  externalTransactionId: string | null;
  valueDate: string;
  bookingDate: string | null;
  /** Always positive; `direction` carries the sign. */
  amount: string;
  direction: StatementDirection;
  currency: string;
  reference: string | null;
  counterparty: string | null;
  rawSource: string;
  duplicateStatus: DuplicateStatus;
  createdAt: string;
}

export interface BankReconciliation {
  id: string;
  tenantId: string;
  bankAccountId: string;
  periodId: string;
  status: ReconciliationStatus;
  statementBalance: string | null;
  closedBy: string | null;
  closedAt: string | null;
  closedBookBalance: string | null;
  closedStatementBalance: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface BankMatch {
  id: string;
  tenantId: string;
  reconciliationId: string;
  statementLineId: string;
  glEntryId: string;
  amount: string;
  matchKind: MatchKind;
  matchReason: string | null;
  idempotencyKey: string;
  reversesId: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

/** A suggested pair. Advisory only — nothing is written until confirmed
 *  (ADR-0018 §3). */
export interface MatchCandidate {
  glEntryId: string;
  postingDate: string;
  amount: string;
  documentType: string | null;
  /** Signed ledger amount, so the caller can see why it was proposed. */
  ledgerReference: string;
  score: number;
  reasons: string[];
}

export interface ParsedStatementLine {
  externalTransactionId: string | null;
  valueDate: string;
  bookingDate: string | null;
  amount: string;
  direction: StatementDirection;
  currency: string;
  reference: string | null;
  counterparty: string | null;
  rawSource: string;
}

export interface PeriodMovement {
  periodId: string;
  bookMovement: string;
  statementMovement: string;
  difference: string;
  currency: string;
  /** Source of each figure, so a UI never has to guess (ADR-0018 §1). */
  bookSource: "accounting_kernel_gl_entries";
  statementSource: "imported_statement_lines";
}

// ---------------------------------------------------------------------------
// Exact 2-decimal money (integer cents). Parse fails closed, never a silent 0.
// ---------------------------------------------------------------------------

const MONEY_2DP = /^\d{1,16}(\.\d{1,2})?$/;

export function toCents(value: string | number | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!MONEY_2DP.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  return BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
}

export function fromCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** Signed magnitude of a statement line: credit money in, debit money out. */
export function signedLineCents(amount: string, direction: StatementDirection): bigint | null {
  const cents = toCents(amount);
  if (cents === null) return null;
  return direction === "credit" ? cents : -cents;
}

/** Signed magnitude of a GL entry as it affects the ledger account. */
export function signedGlCents(debit: string, credit: string): bigint | null {
  const d = toCents(debit);
  const c = toCents(credit);
  if (d === null || c === null) return null;
  return d - c;
}

// ---------------------------------------------------------------------------
// csv_v1 — explicit format profile (ADR-0018 §2)
// ---------------------------------------------------------------------------

/** Describe why a file cannot be imported. Never throws on bad data: the
 *  caller reports the row so an operator can fix the file. */
export class CsvFormatError extends Error {
  constructor(
    message: string,
    readonly rowNumber: number | null = null,
  ) {
    super(message);
    this.name = "CsvFormatError";
  }
}

/**
 * Split one CSV record, honouring double-quoted fields with `""` escapes.
 * A bank export routinely quotes a counterparty containing a comma, so a
 * plain `split(",")` would silently shift every later column.
 */
export function splitCsvRecord(record: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < record.length; i += 1) {
    const char = record[i];
    if (inQuotes) {
      if (char === '"') {
        if (record[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

/**
 * Parse a `csv_v1` statement. The column set is fixed by the profile: a header
 * line naming its columns, then one record per statement line. `direction` is
 * read when present and otherwise taken from the sign of `amount`, because
 * both export styles are common and guessing wrong would flip the sign of a
 * reconciliation.
 */
export function parseStatementCsv(content: string): { rows: ParsedStatementLine[]; errors: CsvFormatError[] } {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new CsvFormatError("statement file is empty");

  const header = splitCsvRecord(lines[0]).map((h) => h.toLowerCase());
  for (const required of CSV_V1_REQUIRED_COLUMNS) {
    if (!header.includes(required)) {
      throw new CsvFormatError(`csv_v1 requires a "${required}" column; header was: ${header.join(", ")}`);
    }
  }
  const index = (name: string) => header.indexOf(name);
  const at = (fields: string[], name: string) => {
    const i = index(name);
    return i >= 0 ? (fields[i] ?? "").trim() || null : null;
  };

  const rows: ParsedStatementLine[] = [];
  const errors: CsvFormatError[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const raw = lines[i];
    const rowNumber = i + 1;
    const fields = splitCsvRecord(raw);
    try {
      const valueDate = at(fields, "value_date");
      if (!valueDate || !/^\d{4}-\d{2}-\d{2}$/.test(valueDate)) {
        throw new CsvFormatError(`value_date must be YYYY-MM-DD, got "${valueDate ?? ""}"`, rowNumber);
      }
      const bookingDate = at(fields, "booking_date");
      if (bookingDate && !/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) {
        throw new CsvFormatError(`booking_date must be YYYY-MM-DD, got "${bookingDate}"`, rowNumber);
      }

      const rawAmount = at(fields, "amount");
      if (!rawAmount) throw new CsvFormatError("amount is missing", rowNumber);
      const negative = rawAmount.startsWith("-");
      const magnitude = negative ? rawAmount.slice(1) : rawAmount;
      if (toCents(magnitude) === null) {
        throw new CsvFormatError(`amount must be a 2-decimal number, got "${rawAmount}"`, rowNumber);
      }

      const statedDirection = at(fields, "direction")?.toLowerCase() ?? null;
      if (statedDirection !== null && statedDirection !== "debit" && statedDirection !== "credit") {
        throw new CsvFormatError(`direction must be debit or credit, got "${statedDirection}"`, rowNumber);
      }
      const direction: StatementDirection =
        statedDirection === "debit" || statedDirection === "credit"
          ? statedDirection
          : negative
            ? "debit"
            : "credit";

      const currency = (at(fields, "currency") ?? "").toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) {
        throw new CsvFormatError(`currency must be a 3-letter ISO code, got "${currency}"`, rowNumber);
      }

      rows.push({
        externalTransactionId: at(fields, "external_transaction_id"),
        valueDate,
        bookingDate,
        amount: magnitude,
        direction,
        currency,
        reference: at(fields, "reference"),
        counterparty: at(fields, "counterparty"),
        rawSource: raw,
      });
    } catch (err) {
      if (err instanceof CsvFormatError) {
        errors.push(err.rowNumber === null ? new CsvFormatError(err.message, rowNumber) : err);
      } else {
        throw err;
      }
    }
  }
  return { rows, errors };
}

/**
 * Deterministic digest of the source file's *content*, derived from the parsed
 * rows rather than trusted from the caller: a caller-supplied hash could be
 * wrong and would let the same file import twice (ADR-0018 §2).
 */
export function statementImportHash(sourceFileName: string, rows: ParsedStatementLine[]): string {
  const canonical = rows
    .map((r) =>
      [
        r.externalTransactionId ?? "",
        r.valueDate,
        r.bookingDate ?? "",
        r.amount,
        r.direction,
        r.currency,
        r.reference ?? "",
        r.counterparty ?? "",
      ].join("\u0001"),
    )
    .join("\u0002");
  return createHash("sha256").update(`${sourceFileName}\u0000${canonical}`).digest("hex");
}

// ---------------------------------------------------------------------------
// Reserved integration ports (ADR-0018 §4)
//
// Declared so a future adapter has an explicit seam and cannot reach the
// ledger directly. Nothing implements them in Wave A6 and none is wired into
// the container: `BankPaymentInitiator` is disabled by the Founder decision
// and direct bank APIs, payment initiation, credential handling, signing and
// host-to-host channels are outside this wave.
// ---------------------------------------------------------------------------

export interface BankStatementProvider {
  fetchStatements(input: {
    tenantId: string;
    bankAccountId: string;
    fromDate: string;
    toDate: string;
  }): Promise<ParsedStatementLine[]>;
}

export interface BankTransactionImporter {
  importTransactions(input: {
    tenantId: string;
    bankAccountId: string;
    formatProfile: string;
    content: string;
  }): Promise<ParsedStatementLine[]>;
}

export interface BankBalanceProvider {
  fetchBalance(input: { tenantId: string; bankAccountId: string; asOfDate: string }): Promise<{
    balance: string;
    currency: string;
    asOfDate: string;
  }>;
}

/** Disabled in Wave A6. Not implemented anywhere — declared for readiness only. */
export interface BankPaymentInitiator {
  initiatePayment(input: { tenantId: string; bankAccountId: string; payload: unknown }): Promise<never>;
}