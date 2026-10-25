import type { Pool, PoolClient } from "pg";
import {
  type BankAccount,
  type BankMatch,
  type BankReconciliation,
  type BankStatementImport,
  type BankStatementLine,
  type DuplicateStatus,
  type MatchCandidate,
  type MatchKind,
  type ParsedStatementLine,
  type PeriodMovement,
  type ReconciliationPolicy,
  fromCents,
  signedGlCents,
  signedLineCents,
  statementImportHash,
  toCents,
} from "../domain/bank-recon.entity.js";

type Row = Record<string, unknown>;

/** `date` columns arrive as Date objects; reformat without a timezone shift. */
function toDateStr(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toBankAccount(row: Row): BankAccount {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    legalEntityId: row.legal_entity_id as string,
    bankName: row.bank_name as string,
    houseBankCode: row.house_bank_code as string,
    bankAccountId: row.bank_account_id as string,
    accountNumberMasked: row.account_number_masked as string,
    name: row.name as string,
    currency: row.currency as string,
    ledgerAccountId: row.ledger_account_id as string,
    reconciliationPolicy: row.reconciliation_policy as ReconciliationPolicy,
    effectiveFrom: toDateStr(row.effective_from),
    effectiveTo: row.effective_to ? toDateStr(row.effective_to) : null,
    isActive: row.is_active as boolean,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

function toImport(row: Row): BankStatementImport {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    bankAccountId: row.bank_account_id as string,
    formatProfile: row.format_profile as string,
    sourceFileName: row.source_file_name as string,
    importHash: row.import_hash as string,
    lineCount: row.line_count as number,
    duplicateLineCount: row.duplicate_line_count as number,
    importedBy: (row.imported_by as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

function toLine(row: Row): BankStatementLine {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    importId: row.import_id as string,
    bankAccountId: row.bank_account_id as string,
    externalTransactionId: (row.external_transaction_id as string | null) ?? null,
    valueDate: toDateStr(row.value_date),
    bookingDate: row.booking_date ? toDateStr(row.booking_date) : null,
    amount: String(row.amount),
    direction: row.direction as BankStatementLine["direction"],
    currency: row.currency as string,
    reference: (row.reference as string | null) ?? null,
    counterparty: (row.counterparty as string | null) ?? null,
    rawSource: row.raw_source as string,
    duplicateStatus: row.duplicate_status as DuplicateStatus,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

function toReconciliation(row: Row): BankReconciliation {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    bankAccountId: row.bank_account_id as string,
    periodId: row.period_id as string,
    status: row.status as BankReconciliation["status"],
    statementBalance: row.statement_balance === null ? null : String(row.statement_balance),
    closedBy: (row.closed_by as string | null) ?? null,
    closedAt: row.closed_at ? (row.closed_at as Date).toISOString() : null,
    closedBookBalance:
      row.closed_book_balance === null ? null : String(row.closed_book_balance),
    closedStatementBalance:
      row.closed_statement_balance === null ? null : String(row.closed_statement_balance),
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

function toMatch(row: Row): BankMatch {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    reconciliationId: row.reconciliation_id as string,
    statementLineId: row.statement_line_id as string,
    glEntryId: row.gl_entry_id as string,
    amount: String(row.amount),
    matchKind: row.match_kind as MatchKind,
    matchReason: (row.match_reason as string | null) ?? null,
    idempotencyKey: row.idempotency_key as string,
    reversesId: (row.reverses_id as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

/** Thrown when a reconciliation write violates a closed invariant. */
export class ReconciliationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconciliationError";
  }
}

/** Postgres unique violation. Mapped to a refusal rather than a 500. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

/**
 * Matched total for one statement line, signed so a compensating unmatch
 * cancels the row it reverses. `reverses_id` carries the sign, never a delete.
 */
const MATCHED_EXPR = `
  COALESCE(SUM(CASE WHEN m.reverses_id IS NULL THEN m.amount ELSE -m.amount END), 0)::text`;

export class PgBankReconRepository {
  constructor(private readonly pool: Pool) {}

  private async inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  // ------------------------------------------------------------------
  // Bank accounts (ADR-0018 §1)
  // ------------------------------------------------------------------

  async createBankAccount(input: {
    tenantId: string;
    legalEntityId: string;
    bankName: string;
    houseBankCode: string;
    bankAccountId: string;
    accountNumberMasked: string;
    name: string;
    currency: string;
    ledgerAccountId: string;
    reconciliationPolicy: ReconciliationPolicy;
    effectiveFrom: string;
    effectiveTo: string | null;
    createdBy: string | null;
  }): Promise<BankAccount> {
    const res = await this.pool.query(
      `INSERT INTO finance_bank_accounts
         (tenant_id, legal_entity_id, bank_name, house_bank_code, bank_account_id,
          account_number_masked, name, currency, ledger_account_id,
          reconciliation_policy, effective_from, effective_to, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        input.tenantId,
        input.legalEntityId,
        input.bankName,
        input.houseBankCode,
        input.bankAccountId,
        input.accountNumberMasked,
        input.name,
        input.currency,
        input.ledgerAccountId,
        input.reconciliationPolicy,
        input.effectiveFrom,
        input.effectiveTo,
        input.createdBy,
      ],
    );
    return toBankAccount(res.rows[0]);
  }

  async findBankAccountById(tenantId: string, id: string): Promise<BankAccount | null> {
    const res = await this.pool.query(
      `SELECT * FROM finance_bank_accounts WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return res.rowCount ? toBankAccount(res.rows[0]) : null;
  }

  async listBankAccounts(
    tenantId: string,
    filter: { legalEntityId?: string; isActive?: boolean },
  ): Promise<BankAccount[]> {
    const clauses = ["tenant_id = $1"];
    const params: unknown[] = [tenantId];
    if (filter.legalEntityId) {
      params.push(filter.legalEntityId);
      clauses.push(`legal_entity_id = $${params.length}`);
    }
    if (filter.isActive !== undefined) {
      params.push(filter.isActive);
      clauses.push(`is_active = $${params.length}`);
    }
    const res = await this.pool.query(
      `SELECT * FROM finance_bank_accounts WHERE ${clauses.join(" AND ")}
        ORDER BY bank_name, house_bank_code, bank_account_id`,
      params,
    );
    return res.rows.map(toBankAccount);
  }

  // ------------------------------------------------------------------
  // Import (ADR-0018 §2)
  // ------------------------------------------------------------------

  /**
   * Import one parsed statement. All-or-nothing: the import row, its accepted
   * lines and its review-queue rows commit together, so a partial statement
   * can never look like a complete one.
   *
   * Duplicate detection keys on (tenant, bank account, external transaction id)
   * — see the migration comment: the re-import that exposes a duplicate is
   * usually a *different* file, so scoping to `import_id` would double-count.
   */
  async importStatement(input: {
    tenantId: string;
    bankAccountId: string;
    formatProfile: string;
    sourceFileName: string;
    rows: ParsedStatementLine[];
    importedBy: string | null;
  }): Promise<{ statementImport: BankStatementImport; lines: BankStatementLine[] }> {
    const importHash = statementImportHash(input.sourceFileName, input.rows);
    try {
      return await this.inTransaction(async (client) => {
        const importRes = await client.query(
          `INSERT INTO finance_bank_statement_imports
             (tenant_id, bank_account_id, format_profile, source_file_name, import_hash, imported_by)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING *`,
          [
            input.tenantId,
            input.bankAccountId,
            input.formatProfile,
            input.sourceFileName,
            importHash,
            input.importedBy,
          ],
        );
        const importRow = toImport(importRes.rows[0]);

        const lines: BankStatementLine[] = [];
        let duplicateCount = 0;
        for (const row of input.rows) {
          let status: DuplicateStatus = "accepted";
          if (row.externalTransactionId !== null) {
            const seen = await client.query(
              `SELECT 1 FROM finance_bank_statement_lines
                WHERE tenant_id = $1 AND bank_account_id = $2
                  AND external_transaction_id = $3 AND duplicate_status = 'accepted'
                LIMIT 1`,
              [input.tenantId, input.bankAccountId, row.externalTransactionId],
            );
            if (seen.rowCount) {
              status = "review_queue";
              duplicateCount += 1;
            }
          }
          const lineRes = await client.query(
            `INSERT INTO finance_bank_statement_lines
               (tenant_id, import_id, bank_account_id, external_transaction_id, value_date,
                booking_date, amount, direction, currency, reference, counterparty,
                raw_source, duplicate_status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             RETURNING *`,
            [
              input.tenantId,
              importRow.id,
              input.bankAccountId,
              row.externalTransactionId,
              row.valueDate,
              row.bookingDate,
              row.amount,
              row.direction,
              row.currency,
              row.reference,
              row.counterparty,
              row.rawSource,
              status,
            ],
          );
          lines.push(toLine(lineRes.rows[0]));
        }

        const updated = await client.query(
          `UPDATE finance_bank_statement_imports
              SET line_count = $2, duplicate_line_count = $3
            WHERE tenant_id = $1 AND id = $4
            RETURNING *`,
          [input.tenantId, lines.length, duplicateCount, importRow.id],
        );
        return { statementImport: toImport(updated.rows[0]), lines };
      });
    } catch (err) {
      // Re-importing the same file fails closed at the unique import hash
      // (ADR-0018 §2): a 23505 here is the refusal, not a server error.
      if (isUniqueViolation(err)) {
        throw new ReconciliationError(
          `This statement was already imported for this bank account (${input.sourceFileName})`,
        );
      }
      throw err;
    }
  }

  async listStatementLines(
    tenantId: string,
    filter: { bankAccountId?: string; importId?: string; includeDuplicates?: boolean },
  ): Promise<BankStatementLine[]> {
    const clauses = ["tenant_id = $1"];
    const params: unknown[] = [tenantId];
    if (filter.bankAccountId) {
      params.push(filter.bankAccountId);
      clauses.push(`bank_account_id = $${params.length}`);
    }
    if (filter.importId) {
      params.push(filter.importId);
      clauses.push(`import_id = $${params.length}`);
    }
    if (!filter.includeDuplicates) clauses.push(`duplicate_status = 'accepted'`);
    const res = await this.pool.query(
      `SELECT * FROM finance_bank_statement_lines WHERE ${clauses.join(" AND ")}
        ORDER BY value_date, created_at`,
      params,
    );
    return res.rows.map(toLine);
  }

  async findStatementLineById(tenantId: string, id: string): Promise<BankStatementLine | null> {
    const res = await this.pool.query(
      `SELECT * FROM finance_bank_statement_lines WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return res.rowCount ? toLine(res.rows[0]) : null;
  }

  /** Matched total for one statement line (signed by reversal). */
  async matchedAmountOf(client: PoolClient | Pool, tenantId: string, lineId: string): Promise<string> {
    const res = await client.query(
      `SELECT ${MATCHED_EXPR} AS matched
         FROM finance_bank_matches m
        WHERE m.tenant_id = $1 AND m.statement_line_id = $2`,
      [tenantId, lineId],
    );
    return String(res.rows[0].matched);
  }

  // ------------------------------------------------------------------
  // Reconciliations (ADR-0018 §3)
  // ------------------------------------------------------------------

  async openReconciliation(input: {
    tenantId: string;
    bankAccountId: string;
    periodId: string;
    createdBy: string | null;
  }): Promise<BankReconciliation> {
    const res = await this.pool.query(
      `INSERT INTO finance_bank_reconciliations
         (tenant_id, bank_account_id, period_id, created_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, bank_account_id, period_id) DO UPDATE
         SET created_at = finance_bank_reconciliations.created_at
       RETURNING *`,
      [input.tenantId, input.bankAccountId, input.periodId, input.createdBy],
    );
    return toReconciliation(res.rows[0]);
  }

  async findReconciliationById(tenantId: string, id: string): Promise<BankReconciliation | null> {
    const res = await this.pool.query(
      `SELECT * FROM finance_bank_reconciliations WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return res.rowCount ? toReconciliation(res.rows[0]) : null;
  }

  async listReconciliations(
    tenantId: string,
    filter: { bankAccountId?: string },
  ): Promise<BankReconciliation[]> {
    const clauses = ["tenant_id = $1"];
    const params: unknown[] = [tenantId];
    if (filter.bankAccountId) {
      params.push(filter.bankAccountId);
      clauses.push(`bank_account_id = $${params.length}`);
    }
    const res = await this.pool.query(
      `SELECT * FROM finance_bank_reconciliations WHERE ${clauses.join(" AND ")}
        ORDER BY created_at DESC`,
      params,
    );
    return res.rows.map(toReconciliation);
  }

  // ------------------------------------------------------------------
  // Matching (ADR-0018 §3)
  // ------------------------------------------------------------------

  /**
   * Record a match under the reconciliation row lock, so two operators cannot
   * both claim the same remaining statement amount. A split match is simply
   * several rows under the line; a many-to-one match is several statement
   * lines against one GL entry. Over-matching fails closed.
   */
  async createMatch(input: {
    tenantId: string;
    reconciliationId: string;
    statementLineId: string;
    glEntryId: string;
    amount: string;
    matchKind: MatchKind;
    matchReason: string | null;
    idempotencyKey: string;
    note: string | null;
    createdBy: string | null;
  }): Promise<BankMatch> {
    const amountCents = toCents(input.amount);
    if (amountCents === null || amountCents <= 0n) {
      throw new ReconciliationError("Match amount must be a positive 2-decimal value");
    }
    return this.inTransaction(async (client) => {
      // A replay must return the row it already wrote, not re-run the guards
      // against a line whose remaining amount it has itself consumed.
      const replay = await client.query(
        `SELECT * FROM finance_bank_matches
          WHERE tenant_id = $1 AND idempotency_key = $2`,
        [input.tenantId, input.idempotencyKey],
      );
      if (replay.rowCount) return toMatch(replay.rows[0]);

      const lock = await client.query(
        `SELECT * FROM finance_bank_reconciliations
          WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [input.tenantId, input.reconciliationId],
      );
      if (!lock.rowCount) throw new ReconciliationError("Reconciliation not found");
      const recon = toReconciliation(lock.rows[0]);
      if (recon.status === "closed") {
        throw new ReconciliationError(
          "Reconciliation is closed; correction requires a governed reopen, not an edit",
        );
      }

      const lineRes = await client.query(
        `SELECT * FROM finance_bank_statement_lines
          WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, input.statementLineId],
      );
      if (!lineRes.rowCount) throw new ReconciliationError("Statement line not found");
      const line = toLine(lineRes.rows[0]);
      if (line.bankAccountId !== recon.bankAccountId) {
        throw new ReconciliationError("Statement line belongs to a different bank account");
      }
      if (line.duplicateStatus !== "accepted") {
        throw new ReconciliationError("Statement line is held in the duplicate review queue");
      }

      // Recompute under the lock: a concurrent match may have landed since the
      // caller read the line.
      const matchedCents = toCents(await this.matchedAmountOf(client, input.tenantId, line.id)) ?? 0n;
      const lineCents = toCents(line.amount) ?? 0n;
      if (matchedCents + amountCents > lineCents) {
        throw new ReconciliationError(
          `Match exceeds the statement line's remaining amount (${fromCents(lineCents - matchedCents)} available)`,
        );
      }

      const glRes = await client.query(
        `SELECT id FROM general_ledger_entries WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, input.glEntryId],
      );
      if (!glRes.rowCount) throw new ReconciliationError("GL entry not found for this tenant");

      const res = await client.query(
        `INSERT INTO finance_bank_matches
           (tenant_id, reconciliation_id, statement_line_id, gl_entry_id, amount,
            match_kind, match_reason, idempotency_key, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (tenant_id, idempotency_key) DO UPDATE
           SET created_at = finance_bank_matches.created_at
         RETURNING *`,
        [
          input.tenantId,
          input.reconciliationId,
          input.statementLineId,
          input.glEntryId,
          input.amount,
          input.matchKind,
          input.matchReason,
          input.idempotencyKey,
          input.note,
          input.createdBy,
        ],
      );
      return toMatch(res.rows[0]);
    });
  }

  /** Compensating unmatch: a new row pointing at the one it reverses. */
  async reverseMatch(input: {
    tenantId: string;
    matchId: string;
    idempotencyKey: string;
    note: string | null;
    createdBy: string | null;
  }): Promise<BankMatch> {
    return this.inTransaction(async (client) => {
      const originalRes = await client.query(
        `SELECT * FROM finance_bank_matches WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, input.matchId],
      );
      if (!originalRes.rowCount) throw new ReconciliationError("Match not found");
      const original = toMatch(originalRes.rows[0]);
      if (original.reversesId !== null) {
        throw new ReconciliationError("A compensating match cannot itself be reversed");
      }

      const lock = await client.query(
        `SELECT * FROM finance_bank_reconciliations
          WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [input.tenantId, original.reconciliationId],
      );
      if (lock.rowCount && toReconciliation(lock.rows[0]).status === "closed") {
        throw new ReconciliationError(
          "Reconciliation is closed; correction requires a governed reopen, not an edit",
        );
      }

      const res = await client.query(
        `INSERT INTO finance_bank_matches
           (tenant_id, reconciliation_id, statement_line_id, gl_entry_id, amount,
            match_kind, match_reason, idempotency_key, reverses_id, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          input.tenantId,
          original.reconciliationId,
          original.statementLineId,
          original.glEntryId,
          original.amount,
          original.matchKind,
          original.matchReason,
          input.idempotencyKey,
          original.id,
          input.note,
          input.createdBy,
        ],
      );
      return toMatch(res.rows[0]);
    });
  }

  async listMatches(tenantId: string, reconciliationId: string): Promise<BankMatch[]> {
    const res = await this.pool.query(
      `SELECT * FROM finance_bank_matches
        WHERE tenant_id = $1 AND reconciliation_id = $2
        ORDER BY created_at`,
      [tenantId, reconciliationId],
    );
    return res.rows.map(toMatch);
  }

  /**
   * Deterministic candidates for one statement line (ADR-0018 §3): amount and
   * date tolerance first, then reference and counterparty as tie-breakers.
   * Advisory only — nothing is written here.
   *
   * Only GL entries that have not yet been fully matched are proposed, so a
   * suggestion never points at money already claimed.
   */
  async suggestCandidates(
    tenantId: string,
    statementLineId: string,
    options: { dateToleranceDays: number },
  ): Promise<MatchCandidate[]> {
    const lineRes = await this.pool.query(
      `SELECT * FROM finance_bank_statement_lines WHERE tenant_id = $1 AND id = $2`,
      [tenantId, statementLineId],
    );
    if (!lineRes.rowCount) return [];
    const line = toLine(lineRes.rows[0]);
    const lineCents = signedLineCents(line.amount, line.direction);
    if (lineCents === null) return [];

    // Candidate ledger entries: same tenant, same ledger account, within the
    // date tolerance, and the signed amount matches the statement line.
    const glRes = await this.pool.query(
      `SELECT g.id, g.posting_date, g.debit, g.credit, g.document_type,
              COALESCE((
                SELECT SUM(CASE WHEN m.reverses_id IS NULL THEN m.amount ELSE -m.amount END)
                  FROM finance_bank_matches m
                 WHERE m.tenant_id = g.tenant_id AND m.gl_entry_id = g.id
              ), 0)::text AS matched
         FROM general_ledger_entries g
        WHERE g.tenant_id = $1
          AND g.account_id = (
            SELECT ba.ledger_account_id FROM finance_bank_accounts ba
             WHERE ba.tenant_id = $1 AND ba.id = $2
          )
          AND g.posting_date::date BETWEEN ($3::date - $4::int) AND ($3::date + $4::int)`,
      [tenantId, line.bankAccountId, line.valueDate, options.dateToleranceDays],
    );

    const candidates: MatchCandidate[] = [];
    for (const row of glRes.rows) {
      const debit = String(row.debit);
      const credit = String(row.credit);
      const glCents = signedGlCents(debit, credit);
      if (glCents === null) continue;
      const alreadyMatched = toCents(String(row.matched)) ?? 0n;
      if (alreadyMatched >= (glCents < 0n ? -glCents : glCents)) continue;

      const reasons: string[] = [];
      let score = 0;
      if (glCents === lineCents) {
        score += 60;
        reasons.push("amount matches exactly");
      } else {
        continue;
      }
      const postingDate = toDateStr(row.posting_date);
      if (postingDate === line.valueDate) {
        score += 25;
        reasons.push("same value date");
      } else {
        score += 10;
        reasons.push("within date tolerance");
      }
      if (line.reference && (row.document_type as string | null) === line.reference) {
        score += 15;
        reasons.push("reference matches document type");
      }
      candidates.push({
        glEntryId: row.id as string,
        postingDate,
        amount: fromCents(glCents < 0n ? -glCents : glCents),
        documentType: (row.document_type as string | null) ?? null,
        ledgerReference: glCents < 0n ? "credit" : "debit",
        score,
        reasons,
      });
    }
    return candidates.sort((a, b) => b.score - a.score || a.postingDate.localeCompare(b.postingDate));
  }

  // ------------------------------------------------------------------
  // Balances (ADR-0018 §1) — two sources, never merged
  // ------------------------------------------------------------------

  /**
   * Book movement (Accounting Kernel GL facts on the mapped ledger account)
   * against statement movement (imported lines for the period's date range).
   * Each figure names its source so a caller can label provenance instead of
   * presenting a derived number as if it were the bank's.
   */
  async periodMovement(input: {
    tenantId: string;
    bankAccountId: string;
    periodId: string;
  }): Promise<PeriodMovement | null> {
    const periodRes = await this.pool.query(
      `SELECT date_from, date_to FROM accounting_periods WHERE tenant_id = $1 AND id = $2`,
      [input.tenantId, input.periodId],
    );
    if (!periodRes.rowCount) return null;
    const dateFrom = toDateStr(periodRes.rows[0].date_from);
    const dateTo = toDateStr(periodRes.rows[0].date_to);

    const account = await this.findBankAccountById(input.tenantId, input.bankAccountId);
    if (!account) return null;

    const bookRes = await this.pool.query(
      `SELECT COALESCE(SUM(debit), 0)::text AS debit, COALESCE(SUM(credit), 0)::text AS credit
         FROM general_ledger_entries
        WHERE tenant_id = $1 AND account_id = $2
          AND posting_date::date BETWEEN $3::date AND $4::date`,
      [input.tenantId, account.ledgerAccountId, dateFrom, dateTo],
    );
    const bookCents =
      (toCents(String(bookRes.rows[0].debit)) ?? 0n) - (toCents(String(bookRes.rows[0].credit)) ?? 0n);

    const lineRes = await this.pool.query(
      `SELECT amount, direction FROM finance_bank_statement_lines
        WHERE tenant_id = $1 AND bank_account_id = $2
          AND duplicate_status = 'accepted'
          AND value_date BETWEEN $3::date AND $4::date`,
      [input.tenantId, input.bankAccountId, dateFrom, dateTo],
    );
    let statementCents = 0n;
    for (const row of lineRes.rows) {
      statementCents += signedLineCents(String(row.amount), row.direction as "debit" | "credit") ?? 0n;
    }

    return {
      periodId: input.periodId,
      bookMovement: fromCents(bookCents),
      statementMovement: fromCents(statementCents),
      difference: fromCents(bookCents - statementCents),
      currency: account.currency,
      bookSource: "accounting_kernel_gl_entries",
      statementSource: "imported_statement_lines",
    };
  }

  /**
   * Close the reconciliation: freeze the match set and record both balances at
   * the moment of closing, so a later correction cannot rewrite what was
   * certified (ADR-0018 §3).
   */
  async closeReconciliation(input: {
    tenantId: string;
    reconciliationId: string;
    statementBalance: string | null;
    bookBalance: string;
    closedBy: string;
  }): Promise<BankReconciliation> {
    const res = await this.pool.query(
      `UPDATE finance_bank_reconciliations
          SET status = 'closed',
              statement_balance = COALESCE($3::numeric, statement_balance),
              closed_by = $4,
              closed_at = now(),
              closed_book_balance = $5::numeric,
              closed_statement_balance = COALESCE($3::numeric, statement_balance)
        WHERE tenant_id = $1 AND id = $2 AND status = 'open'
        RETURNING *`,
      [
        input.tenantId,
        input.reconciliationId,
        input.statementBalance,
        input.closedBy,
        input.bookBalance,
      ],
    );
    if (!res.rowCount) throw new ReconciliationError("Reconciliation is not open");
    return toReconciliation(res.rows[0]);
  }
}
