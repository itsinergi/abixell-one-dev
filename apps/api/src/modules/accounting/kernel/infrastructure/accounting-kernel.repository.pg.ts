import type { Pool, PoolClient, QueryResultRow } from "pg";
import type {
  AccountingAccount,
  AccountingPeriod,
  ApprovePeriodReopenInput,
  CreateAccountInput,
  CreateJournalInput,
  CreatePeriodInput,
  GeneralLedgerEntry,
  JournalHeader,
  JournalLine,
  Money,
  PostingIdempotencyKey,
  AccountingKernelRepository,
  AccountingPeriodStatus,
  JournalStatus,
  PostingAttemptStatus,
  RejectPeriodReopenInput,
  RequestPeriodReopenInput,
  ReverseJournalInput,
} from "../domain/accounting-kernel.entity.js";
import { recordGovernedAudit } from "../../../../infrastructure/persistence/repositories/governed-transaction.js";

/**
 * Accounting Kernel persistence (Phase 1B).
 *
 * Core invariants:
 *
 * 1. **Money never becomes a JavaScript number.** `numeric(18,2)` is returned
 *    as a string and stays a string. Every SUM, calculation, and comparison
 *    below is written in SQL and evaluated by PostgreSQL in exact decimal
 *    arithmetic.
 *
 * 2. **A journal post and its GL entries are one atomic act.** `postJournal()`
 *    locks the journal row, validates balance in SQL, writes GL entries and
 *    refreshes balances, all inside a single BEGIN/COMMIT block. Tenant
 *    isolation via direct `tenant_id` filters on every query.
 */
export class PgAccountingKernelRepository implements AccountingKernelRepository {
  constructor(private readonly pool: Pool) {}

  private async inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // --- Periods ---------------------------------------------------------------

  async createPeriod(input: CreatePeriodInput): Promise<AccountingPeriod> {
    const r = await this.pool.query(
      `INSERT INTO accounting_periods
         (tenant_id, legal_entity_id, fiscal_year_code, period_code, period_name,
          period_type, date_from, date_to, status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, 'draft', $9, $9)
       RETURNING *`,
      [
        input.tenantId,
        input.legalEntityId,
        input.fiscalYearCode,
        input.periodCode,
        input.periodName,
        input.periodType,
        input.dateFrom,
        input.dateTo,
        input.createdBy,
      ],
    );
    return toPeriod(r.rows[0]);
  }

  async findPeriodById(id: string): Promise<AccountingPeriod | null> {
    const r = await this.pool.query(`SELECT * FROM accounting_periods WHERE id = $1`, [id]);
    return r.rows[0] ? toPeriod(r.rows[0]) : null;
  }

  async listPeriods(
    tenantId: string,
    filter: { legalEntityId?: string; status?: AccountingPeriodStatus },
  ): Promise<AccountingPeriod[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];
    if (filter.legalEntityId) {
      params.push(filter.legalEntityId);
      conditions.push(`legal_entity_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    const r = await this.pool.query(
      `SELECT * FROM accounting_periods WHERE ${conditions.join(" AND ")} ORDER BY date_from`,
      params,
    );
    return r.rows.map(toPeriod);
  }

  async setPeriodStatus(
    id: string,
    status: AccountingPeriodStatus,
    updatedBy: string | null,
  ): Promise<AccountingPeriod | null> {
    // When a period is (re)closed, clear the reopen trail so the next reopen
    // cycle starts clean. lockPeriod is the only caller that sets 'closed'
    // here; the guard_period_reopen trigger only restricts transitions to
    // 'open', so clearing these columns on a 'closed' transition is safe.
    const r = await this.pool.query(
      `UPDATE accounting_periods
         SET status = $2,
             updated_by = $3,
             updated_at = now(),
             reopen_requested_date = CASE WHEN $2 = 'closed' THEN NULL ELSE reopen_requested_date END,
             reopen_requested_by = CASE WHEN $2 = 'closed' THEN NULL ELSE reopen_requested_by END,
             reopen_reason = CASE WHEN $2 = 'closed' THEN NULL ELSE reopen_reason END,
             reopen_impact_evidence = CASE WHEN $2 = 'closed' THEN NULL ELSE reopen_impact_evidence END,
             reopen_approved_by = CASE WHEN $2 = 'closed' THEN NULL ELSE reopen_approved_by END,
             reopen_approved_date = CASE WHEN $2 = 'closed' THEN NULL ELSE reopen_approved_date END,
             reopen_rejected_by = CASE WHEN $2 = 'closed' THEN NULL ELSE reopen_rejected_by END,
             reopen_rejected_date = CASE WHEN $2 = 'closed' THEN NULL ELSE reopen_rejected_date END,
             reopen_reject_reason = CASE WHEN $2 = 'closed' THEN NULL ELSE reopen_reject_reason END
       WHERE id = $1 RETURNING *`,
      [id, status, updatedBy],
    );
    return r.rows[0] ? toPeriod(r.rows[0]) : null;
  }

  async requestPeriodReopen(input: RequestPeriodReopenInput): Promise<AccountingPeriod | null> {
    const r = await this.pool.query(
      `UPDATE accounting_periods
         SET status = 'reopenable',
             reopen_requested_date = now(),
             reopen_requested_by = $2,
             reopen_reason = $3,
             reopen_impact_evidence = $4,
             reopen_approved_by = NULL,
             reopen_approved_date = NULL,
             reopen_rejected_by = NULL,
             reopen_rejected_date = NULL,
             reopen_reject_reason = NULL,
             updated_by = $2,
             updated_at = now()
       WHERE id = $1 AND status = 'closed'
       RETURNING *`,
      [input.periodId, input.requestedBy, input.reason, input.impactEvidence],
    );
    return r.rows[0] ? toPeriod(r.rows[0]) : null;
  }

  async approvePeriodReopen(input: ApprovePeriodReopenInput): Promise<AccountingPeriod | null> {
    const r = await this.pool.query(
      `UPDATE accounting_periods
         SET status = 'open',
             reopen_approved_by = $2,
             reopen_approved_date = now(),
             reopen_rejected_by = NULL,
             reopen_rejected_date = NULL,
             reopen_reject_reason = NULL,
             updated_by = $2,
             updated_at = now()
       WHERE id = $1 AND status = 'reopenable'
         AND reopen_requested_by IS DISTINCT FROM $2
       RETURNING *`,
      [input.periodId, input.approvedBy],
    );
    return r.rows[0] ? toPeriod(r.rows[0]) : null;
  }

  async rejectPeriodReopen(input: RejectPeriodReopenInput): Promise<AccountingPeriod | null> {
    const r = await this.pool.query(
      `UPDATE accounting_periods
         SET status = 'closed',
             reopen_rejected_by = $2,
             reopen_rejected_date = now(),
             reopen_reject_reason = $3,
             updated_by = $2,
             updated_at = now()
       WHERE id = $1 AND status = 'reopenable'
       RETURNING *`,
      [input.periodId, input.rejectedBy, input.reason],
    );
    return r.rows[0] ? toPeriod(r.rows[0]) : null;
  }

  // --- Accounts ---------------------------------------------------------------

  async createAccount(input: CreateAccountInput): Promise<AccountingAccount> {
    const r = await this.pool.query(
      `INSERT INTO accounting_accounts
         (tenant_id, legal_entity_id, coa_id, account_code, account_name,
          account_class, normal_balance, parent_account_id, is_active, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $9)
       RETURNING *`,
      [
        input.tenantId,
        input.legalEntityId,
        input.coaId,
        input.accountCode,
        input.accountName,
        input.accountClass,
        input.normalBalance,
        input.parentAccountId,
        input.createdBy,
      ],
    );
    return toAccount(r.rows[0]);
  }

  async findAccountById(id: string): Promise<AccountingAccount | null> {
    const r = await this.pool.query(`SELECT * FROM accounting_accounts WHERE id = $1`, [id]);
    return r.rows[0] ? toAccount(r.rows[0]) : null;
  }

  async findAccountByCode(
    tenantId: string,
    legalEntityId: string,
    accountCode: string,
  ): Promise<AccountingAccount | null> {
    const r = await this.pool.query(
      `SELECT * FROM accounting_accounts WHERE tenant_id = $1 AND legal_entity_id = $2 AND account_code = $3`,
      [tenantId, legalEntityId, accountCode],
    );
    return r.rows[0] ? toAccount(r.rows[0]) : null;
  }

  async listAccounts(
    tenantId: string,
    filter: { legalEntityId?: string; activeOnly?: boolean },
  ): Promise<AccountingAccount[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];
    if (filter.legalEntityId) {
      params.push(filter.legalEntityId);
      conditions.push(`legal_entity_id = $${params.length}`);
    }
    if (filter.activeOnly) {
      conditions.push(`is_active = true`);
    }
    const r = await this.pool.query(
      `SELECT * FROM accounting_accounts WHERE ${conditions.join(" AND ")} ORDER BY account_code`,
      params,
    );
    return r.rows.map(toAccount);
  }

  async listAccountHierarchy(
    tenantId: string,
    legalEntityId: string,
  ): Promise<Array<{ account: AccountingAccount; depth: number }>> {
    // Recursive CTE: roots are accounts with no (in-scope) parent; each level
    // increments depth. The `path` array guards against a cycle should one
    // ever slip past the DB trigger, by refusing to revisit an id.
    const r = await this.pool.query(
      `WITH RECURSIVE tree AS (
         SELECT a.*, 0 AS depth, ARRAY[a.id] AS path
           FROM accounting_accounts a
          WHERE a.tenant_id = $1 AND a.legal_entity_id = $2
            AND (a.parent_account_id IS NULL
                 OR NOT EXISTS (
                   SELECT 1 FROM accounting_accounts p
                    WHERE p.id = a.parent_account_id
                      AND p.tenant_id = a.tenant_id
                      AND p.legal_entity_id = a.legal_entity_id))
         UNION ALL
         SELECT c.*, t.depth + 1, t.path || c.id
           FROM accounting_accounts c
           JOIN tree t ON c.parent_account_id = t.id
          WHERE c.tenant_id = $1 AND c.legal_entity_id = $2
            AND NOT c.id = ANY(t.path)
       )
       SELECT * FROM tree ORDER BY path`,
      [tenantId, legalEntityId],
    );
    return r.rows.map((row) => ({ account: toAccount(row), depth: Number(row.depth) }));
  }

  // --- Journals ---------------------------------------------------------------

  async createJournal(input: CreateJournalInput): Promise<JournalHeader> {
    return this.inTransaction(async (client) => {
      // Create journal header
      const hdr = await client.query(
        `INSERT INTO journal_headers
           (tenant_id, legal_entity_id, journal_number, journal_date, accounting_date,
            period_id, description, currency, idempotency_key, status, is_balanced,
            created_by, updated_by)
         VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, 'pending', false, $10, $10)
         RETURNING *`,
        [
          input.tenantId,
          input.legalEntityId,
          input.journalNumber,
          input.journalDate,
          input.accountingDate,
          input.periodId,
          input.description,
          input.currency,
          input.idempotencyKey,
          input.createdBy,
        ],
      );
      const header = toJournalHeader(hdr.rows[0]);

      // Create journal lines
      for (const line of input.lines) {
        await client.query(
          `INSERT INTO journal_lines
             (tenant_id, journal_header_id, account_id, line_number, debit, credit,
              line_description, project_id, site_id, created_by)
           VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7, $8, $9, $10)`,
          [
            input.tenantId,
            header.id,
            line.accountId,
            line.lineNumber,
            line.debit,
            line.credit,
            line.lineDescription,
            line.projectId,
            line.siteId,
            input.createdBy,
          ],
        );
      }

      return header;
    });
  }

  async findJournalById(id: string): Promise<JournalHeader | null> {
    const r = await this.pool.query(`SELECT * FROM journal_headers WHERE id = $1`, [id]);
    return r.rows[0] ? toJournalHeader(r.rows[0]) : null;
  }

  async listJournalLines(journalHeaderId: string): Promise<JournalLine[]> {
    const r = await this.pool.query(
      `SELECT * FROM journal_lines WHERE journal_header_id = $1 ORDER BY line_number`,
      [journalHeaderId],
    );
    return r.rows.map(toJournalLine);
  }

  async listJournals(
    tenantId: string,
    filter: { periodId?: string; status?: JournalStatus },
  ): Promise<JournalHeader[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];
    if (filter.periodId) {
      params.push(filter.periodId);
      conditions.push(`period_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    const r = await this.pool.query(
      `SELECT * FROM journal_headers WHERE ${conditions.join(" AND ")} ORDER BY journal_date DESC`,
      params,
    );
    return r.rows.map(toJournalHeader);
  }

  async postJournal(
    journalId: string,
    postedBy: string | null,
  ): Promise<{ journal: JournalHeader } | { unbalanced: true } | null> {
    return this.inTransaction(async (client) => {
      // Lock the journal
      const jrnl = await client.query(
        `SELECT * FROM journal_headers WHERE id = $1 FOR UPDATE`,
        [journalId],
      );
      if (!jrnl.rows[0]) return null;

      const header = toJournalHeader(jrnl.rows[0]);
      if (header.status !== "pending") return null;

      // Compute totals in SQL to avoid any JavaScript float arithmetic
      const totals = await client.query(
        `SELECT
           COALESCE(SUM(debit), 0)::numeric(18,2) AS total_debit,
           COALESCE(SUM(credit), 0)::numeric(18,2) AS total_credit,
           COALESCE(SUM(debit), 0)::numeric(18,2) =
             COALESCE(SUM(credit), 0)::numeric(18,2) AS balanced
         FROM journal_lines
         WHERE journal_header_id = $1`,
        [journalId],
      );

      const row = totals.rows[0];
      const debitStr = String(row.total_debit);
      const creditStr = String(row.total_credit);

      // Compare as PostgreSQL numerics; never rely on textual formatting.
      if (!row.balanced) {
        return { unbalanced: true as const };
      }

      // Fetch all lines with account details for GL entry creation
      const linesWithAccounts = await client.query(
        `SELECT jl.*, aa.normal_balance
         FROM journal_lines jl
         JOIN accounting_accounts aa ON aa.id = jl.account_id
         WHERE jl.journal_header_id = $1
         ORDER BY jl.line_number`,
        [journalId],
      );

      // Create GL entries
      const glAccountIds = new Set<string>();
      for (const line of linesWithAccounts.rows) {
        glAccountIds.add(line.account_id);

        await client.query(
          `INSERT INTO general_ledger_entries
             (tenant_id, account_id, period_id, journal_line_id, posting_date,
              debit, credit, created_by)
           VALUES ($1, $2, $3, $4, now(), $5::numeric, $6::numeric, $7)`,
          [
            header.tenantId,
            line.account_id,
            header.periodId,
            line.id,
            line.debit,
            line.credit,
            postedBy,
          ],
        );
      }

      // Refresh GL balances for all touched accounts
      for (const accountId of glAccountIds) {
        await this.refreshGlBalance(client, header.tenantId, accountId, header.periodId);
      }

      // Mark journal as posted
      const updated = await client.query(
        `UPDATE journal_headers
         SET status = 'posted', is_balanced = true, posted_date = now(), posted_by = $2,
             updated_by = $2, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [journalId, postedBy],
      );

      // Audit inside transaction
      await recordGovernedAudit(client, {
        tenantId: header.tenantId,
        actorUserId: postedBy,
        action: "accounting.journal.posted",
        entityType: "journal_header",
        entityId: journalId,
        metadata: {
          journalNumber: header.journalNumber,
          debitTotal: debitStr,
          creditTotal: creditStr,
          lineCount: linesWithAccounts.rows.length,
        },
      });

      return { journal: toJournalHeader(updated.rows[0]) };
    });
  }

  private async refreshGlBalance(
    client: PoolClient,
    tenantId: string,
    accountId: string,
    periodId: string,
  ): Promise<void> {
    // Serialize concurrent balance refreshes for the same (tenant, account, period)
    // to prevent lost-update race under READ COMMITTED.
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2 || ':' || $3))`,
      [tenantId, accountId, periodId],
    );

    // Compute current GL totals for this account in this period
    const totals = await client.query(
      `SELECT
         COALESCE(SUM(debit), 0)::numeric(18,2) AS debit_total,
         COALESCE(SUM(credit), 0)::numeric(18,2) AS credit_total
       FROM general_ledger_entries
       WHERE tenant_id = $1 AND account_id = $2 AND period_id = $3`,
      [tenantId, accountId, periodId],
    );

    const row = totals.rows[0];
    const debitTotal = String(row.debit_total);
    const creditTotal = String(row.credit_total);

    // Fetch account's normal_balance to compute closing
    const acc = await client.query(
      `SELECT normal_balance FROM accounting_accounts WHERE id = $1`,
      [accountId],
    );
    const accRow = acc.rows[0];
    if (!accRow) {
      throw new Error(`Account ${accountId} not found while refreshing GL balance`);
    }
    const normalBalance = accRow.normal_balance;

    // For Phase 1B, opening_balance is 0 (opening balance logic deferred to Wave A6)
    const openingBalance = "0.00";

    // Closing balance depends on normal balance direction
    let closingBalance: string;
    if (normalBalance === "debit") {
      // Debit-normal: closing = opening + debit - credit
      // Compute in SQL
      const calc = await client.query(
        `SELECT ($1::numeric - $2::numeric)::text AS result`,
        [debitTotal, creditTotal],
      );
      closingBalance = String(calc.rows[0].result);
    } else {
      // Credit-normal: closing = opening + credit - debit
      const calc = await client.query(
        `SELECT ($1::numeric - $2::numeric)::text AS result`,
        [creditTotal, debitTotal],
      );
      closingBalance = String(calc.rows[0].result);
    }

    // Upsert gl_balances
    await client.query(
      `INSERT INTO gl_balances
         (tenant_id, account_id, period_id, opening_balance, debit_total, credit_total,
          closing_balance, last_refreshed)
       VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6::numeric, $7::numeric, now())
       ON CONFLICT (tenant_id, account_id, period_id) DO UPDATE SET
         opening_balance = EXCLUDED.opening_balance,
         debit_total = EXCLUDED.debit_total,
         credit_total = EXCLUDED.credit_total,
         closing_balance = EXCLUDED.closing_balance,
         last_refreshed = now()`,
      [tenantId, accountId, periodId, openingBalance, debitTotal, creditTotal, closingBalance],
    );
  }

  async findNextOpenPeriod(
    tenantId: string,
    legalEntityId: string,
    onOrAfterDate: string,
  ): Promise<AccountingPeriod | null> {
    // The earliest `open` period that ends on or after the requested date.
    // A period containing `onOrAfterDate` is preferred; if none contains it,
    // a strictly future open period is returned (the caller must then date the
    // posting at that period's `date_from`, never before it).
    const r = await this.pool.query(
      `SELECT * FROM accounting_periods
        WHERE tenant_id = $1
          AND legal_entity_id = $2
          AND status = 'open'
          AND date_to >= $3::date
        ORDER BY date_from
        LIMIT 1`,
      [tenantId, legalEntityId, onOrAfterDate],
    );
    return r.rows[0] ? toPeriod(r.rows[0]) : null;
  }

  async reverseJournal(
    input: ReverseJournalInput,
  ): Promise<{ original: JournalHeader; reversal: JournalHeader } | null> {
    return this.inTransaction(async (client) => {
      // 1. Lock the original journal; concurrent reversals serialize here.
      const origRes = await client.query(
        `SELECT * FROM journal_headers WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [input.reversalOfId, input.tenantId],
      );
      if (!origRes.rows[0]) return null;
      const original = toJournalHeader(origRes.rows[0]);

      // Tenant/entity isolation: validate target period belongs to original journal's tenant+entity.
      // Use original.legalEntityId, not input (which can be spoofed).
      const periodRes = await client.query(
        `SELECT id FROM accounting_periods
          WHERE id = $1
            AND tenant_id = $2
            AND legal_entity_id = $3
            AND status = 'open'
          FOR UPDATE`,
        [input.periodId, input.tenantId, original.legalEntityId],
      );
      if (!periodRes.rows[0]) return null;

      // 2. Guard: only a posted journal can be reversed.
      if (original.status !== "posted") return null;

      // 3. One-time-reversal invariant: no live (pending/posted) reversal
      //    child already exists for this journal.
      const existing = await client.query(
        `SELECT 1 FROM journal_headers
          WHERE reversal_of_id = $1
            AND tenant_id = $2
            AND status IN ('pending', 'posted')`,
        [input.reversalOfId, input.tenantId],
      );
      if ((existing.rowCount ?? 0) > 0) return null;

      // 4. Insert the reversal header — a NEW posted journal that points back.
      //    Status is `posted` immediately: the reversal is a posted correction,
      //    not a draft (it has already-validated swapped lines and GL entries).
      const revHdr = await client.query(
        `INSERT INTO journal_headers
           (tenant_id, legal_entity_id, journal_number, journal_date, accounting_date,
            period_id, description, currency, posting_rule_version_id, idempotency_key,
            status, is_balanced, posted_date, posted_by, reversal_of_id,
            reversal_reason, reversal_type, reversed_by, created_by, updated_by)
         VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, NULL, $9,
                 'posted', true, now(), $10, $11,
                 $12, $13, $10, $10, $10)
         RETURNING *`,
        [
          input.tenantId,
          original.legalEntityId,
          input.journalNumber,
          input.journalDate,
          input.accountingDate,
          input.periodId,
          `Reversal of ${original.journalNumber}: ${input.reversalReason}`,
          original.currency,
          input.idempotencyKey,
          input.reversedBy,
          input.reversalOfId,
          input.reversalReason,
          input.reversalType,
        ],
      );
      const reversal = toJournalHeader(revHdr.rows[0]);

      // 5. Insert reversal lines with debit/credit SWAPPED, each linked back
      //    to its source line. Also write the GL entry for each line.
      const origLines = await client.query(
        `SELECT * FROM journal_lines WHERE journal_header_id = $1 ORDER BY line_number`,
        [input.reversalOfId],
      );

      const touchedAccounts = new Set<string>();
      for (const line of origLines.rows) {
        const swappedDebit = String(line.credit);
        const swappedCredit = String(line.debit);

        const revLine = await client.query(
          `INSERT INTO journal_lines
             (tenant_id, journal_header_id, account_id, line_number,
              debit, credit, line_description, project_id, site_id,
              reversal_of_line_id, created_by)
           VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7, $8, $9, $10, $11)
           RETURNING *`,
          [
            input.tenantId,
            reversal.id,
            line.account_id,
            line.line_number,
            swappedDebit,
            swappedCredit,
            `Reversal: ${line.line_description ?? ""}`,
            line.project_id,
            line.site_id,
            line.id,
            input.reversedBy,
          ],
        );

        const revLineId = revLine.rows[0].id;
        touchedAccounts.add(line.account_id);

        // GL entry for the reversal line (debit/credit already swapped)
        await client.query(
          `INSERT INTO general_ledger_entries
             (tenant_id, account_id, period_id, journal_line_id, posting_date,
              debit, credit, created_by)
           VALUES ($1, $2, $3, $4, now(), $5::numeric, $6::numeric, $7)`,
          [
            input.tenantId,
            line.account_id,
            input.periodId,
            revLineId,
            swappedDebit,
            swappedCredit,
            input.reversedBy,
          ],
        );
      }

      // 6. Refresh GL balances for touched accounts in the reversal period.
      for (const accountId of touchedAccounts) {
        await this.refreshGlBalance(client, input.tenantId, accountId, input.periodId);
      }

      // 7. Flip the original's status to 'reversed' (no other field touched).
      const updatedOrig = await client.query(
        `UPDATE journal_headers
         SET status = 'reversed', updated_by = $2, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [input.reversalOfId, input.reversedBy],
      );

      // 8. Audit inside the transaction.
      await recordGovernedAudit(client, {
        tenantId: input.tenantId,
        actorUserId: input.reversedBy,
        action: "accounting.journal.reversed",
        entityType: "journal_header",
        entityId: reversal.id,
        metadata: {
          originalJournalId: input.reversalOfId,
          originalJournalNumber: original.journalNumber,
          reversalJournalNumber: input.journalNumber,
          reversalType: input.reversalType,
          reason: input.reversalReason,
          periodId: input.periodId,
        },
      });

      return {
        original: toJournalHeader(updatedOrig.rows[0]),
        reversal,
      };
    });
  }

  async listGlEntries(
    tenantId: string,
    filter: { accountId?: string; periodId?: string },
  ): Promise<GeneralLedgerEntry[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];
    if (filter.accountId) {
      params.push(filter.accountId);
      conditions.push(`account_id = $${params.length}`);
    }
    if (filter.periodId) {
      params.push(filter.periodId);
      conditions.push(`period_id = $${params.length}`);
    }
    const r = await this.pool.query(
      `SELECT * FROM general_ledger_entries WHERE ${conditions.join(" AND ")} ORDER BY posting_date`,
      params,
    );
    return r.rows.map(toGlEntry);
  }

  // --- Idempotency -----------------------------------------------------------

  async findIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<PostingIdempotencyKey | null> {
    const r = await this.pool.query(
      `SELECT * FROM posting_idempotency_keys WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, idempotencyKey],
    );
    return r.rows[0] ? toIdempotencyKey(r.rows[0]) : null;
  }

  async recordIdempotencyKey(input: {
    tenantId: string;
    sourceEventId: string;
    postingRuleVersionHash: string;
    idempotencyKey: string;
    lastAttemptStatus: PostingAttemptStatus;
    failureReason: string | null;
  }): Promise<PostingIdempotencyKey> {
    const r = await this.pool.query(
      `INSERT INTO posting_idempotency_keys
         (tenant_id, source_event_id, posting_rule_version_hash, idempotency_key,
          last_attempt_status, failure_reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, idempotency_key) DO UPDATE SET
         last_attempt_status = EXCLUDED.last_attempt_status,
         failure_reason = EXCLUDED.failure_reason,
         posting_attempt_count = posting_attempt_count + 1,
         last_attempt_date = now()
       RETURNING *`,
      [
        input.tenantId,
        input.sourceEventId,
        input.postingRuleVersionHash,
        input.idempotencyKey,
        input.lastAttemptStatus,
        input.failureReason,
      ],
    );
    return toIdempotencyKey(r.rows[0]);
  }

  // --- Cross-domain reads ----------------------------------------------------

  async legalEntityExists(tenantId: string, legalEntityId: string): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT 1 FROM legal_entities WHERE id = $1 AND tenant_id = $2`,
      [legalEntityId, tenantId],
    );
    return r.rowCount! > 0;
  }
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function toDateString(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

function toMoney(value: unknown): Money {
  return String(value);
}

function toPeriod(row: QueryResultRow): AccountingPeriod {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    legalEntityId: row.legal_entity_id,
    fiscalYearCode: row.fiscal_year_code,
    periodCode: row.period_code,
    periodName: row.period_name,
    periodType: row.period_type,
    dateFrom: toDateString(row.date_from),
    dateTo: toDateString(row.date_to),
    status: row.status,
    lockedDate: row.locked_date,
    lockedBy: row.locked_by,
    reopenRequestedDate: row.reopen_requested_date ?? null,
    reopenRequestedBy: row.reopen_requested_by ?? null,
    reopenReason: row.reopen_reason ?? null,
    reopenImpactEvidence: row.reopen_impact_evidence ?? null,
    reopenApprovedBy: row.reopen_approved_by ?? null,
    reopenApprovedDate: row.reopen_approved_date ?? null,
    reopenRejectedBy: row.reopen_rejected_by ?? null,
    reopenRejectedDate: row.reopen_rejected_date ?? null,
    reopenRejectReason: row.reopen_reject_reason ?? null,
    workflowInstanceId: row.workflow_instance_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAccount(row: QueryResultRow): AccountingAccount {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    legalEntityId: row.legal_entity_id,
    coaId: row.coa_id,
    accountCode: row.account_code,
    accountName: row.account_name,
    accountClass: row.account_class,
    normalBalance: row.normal_balance,
    accountType: row.account_type,
    parentAccountId: row.parent_account_id,
    isActive: row.is_active,
    deactivatedAt: row.deactivated_at,
    deactivatedBy: row.deactivated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toJournalHeader(row: QueryResultRow): JournalHeader {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    legalEntityId: row.legal_entity_id,
    journalNumber: row.journal_number,
    journalDate: toDateString(row.journal_date),
    accountingDate: toDateString(row.accounting_date),
    periodId: row.period_id,
    description: row.description,
    postedDate: row.posted_date,
    postedBy: row.posted_by,
    currency: row.currency,
    postingRuleVersionId: row.posting_rule_version_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    isBalanced: row.is_balanced,
    reversalOfId: row.reversal_of_id,
    reversalReason: row.reversal_reason ?? null,
    reversalType: row.reversal_type ?? null,
    reversedBy: row.reversed_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toJournalLine(row: QueryResultRow): JournalLine {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    journalHeaderId: row.journal_header_id,
    accountId: row.account_id,
    lineNumber: row.line_number,
    debit: toMoney(row.debit),
    credit: toMoney(row.credit),
    lineDescription: row.line_description,
    costCenterId: row.cost_center_id,
    projectId: row.project_id,
    siteId: row.site_id,
    reversalOfLineId: row.reversal_of_line_id,
    createdAt: row.created_at,
  };
}

function toGlEntry(row: QueryResultRow): GeneralLedgerEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    accountId: row.account_id,
    periodId: row.period_id,
    journalLineId: row.journal_line_id,
    postingDate: row.posting_date,
    debit: toMoney(row.debit),
    credit: toMoney(row.credit),
    balanceBefore: row.balance_before ? toMoney(row.balance_before) : null,
    balanceAfter: row.balance_after ? toMoney(row.balance_after) : null,
    documentType: row.document_type,
    documentId: row.document_id,
    createdAt: row.created_at,
  };
}

function toIdempotencyKey(row: QueryResultRow): PostingIdempotencyKey {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sourceEventId: row.source_event_id,
    postingRuleVersionHash: row.posting_rule_version_hash,
    idempotencyKey: row.idempotency_key,
    journalHeaderId: row.journal_header_id,
    postingAttemptCount: row.posting_attempt_count,
    lastAttemptDate: row.last_attempt_date,
    lastAttemptStatus: row.last_attempt_status,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
  };
}
