import type { Pool, PoolClient } from "pg";
import {
  type AssetBook,
  type AssetBookEvent,
  type AssetBookEventType,
  type AssetBookStatus,
  type DepreciationRun,
  type DepreciationRunDetail,
  type DepreciationRunLine,
  type DepreciationRunStatus,
  computeSchedule,
  fromCents,
  periodAmount,
  toCents,
} from "../domain/asset-book.entity.js";

type Row = Record<string, unknown>;

/**
 * `date` columns arrive as Date objects built from the *local* midnight, so
 * `toISOString()` would shift them a day in any non-UTC zone. Read the local
 * components instead; a calendar date has no timezone.
 */
function toDateStr(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

function toBook(row: Row): AssetBook {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    legalEntityId: row.legal_entity_id as string,
    ledgerId: row.ledger_id as string,
    assetId: row.asset_id as string,
    bookCode: row.book_code as string,
    assetClass: row.asset_class as string,
    capitalizationDate: toDateStr(row.capitalization_date),
    inServiceDate: toDateStr(row.in_service_date),
    acquisitionCost: String(row.acquisition_cost),
    residualValue: String(row.residual_value),
    usefulLifeMonths: Number(row.useful_life_months),
    methodCode: row.method_code as string,
    methodVersion: Number(row.method_version),
    depreciationExpenseAccountId: row.depreciation_expense_account_id as string,
    accumulatedDepreciationAccountId: row.accumulated_depreciation_account_id as string,
    status: row.status as AssetBookStatus,
    accumulatedDepreciation: String(row.accumulated_depreciation),
    disposedAt: row.disposed_at ? toDateStr(row.disposed_at) : null,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

function toEvent(row: Row): AssetBookEvent {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    assetBookId: row.asset_book_id as string,
    eventType: row.event_type as AssetBookEventType,
    eventDate: toDateStr(row.event_date),
    amount: row.amount === null ? null : String(row.amount),
    evidenceDocumentId: (row.evidence_document_id as string | null) ?? null,
    workflowInstanceId: (row.workflow_instance_id as string | null) ?? null,
    journalId: (row.journal_id as string | null) ?? null,
    reversalOfId: (row.reversal_of_id as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    idempotencyKey: row.idempotency_key as string,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

function toRun(row: Row): DepreciationRun {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    legalEntityId: row.legal_entity_id as string,
    bookCode: row.book_code as string,
    periodId: row.period_id as string,
    status: row.status as DepreciationRunStatus,
    totalAmount: String(row.total_amount),
    currency: row.currency as string,
    journalId: (row.journal_id as string | null) ?? null,
    reversesRunId: (row.reverses_run_id as string | null) ?? null,
    idempotencyKey: row.idempotency_key as string,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

function toRunLine(row: Row): DepreciationRunLine {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    runId: row.run_id as string,
    assetBookId: row.asset_book_id as string,
    amount: String(row.amount),
    accumulatedBefore: String(row.accumulated_before),
    accumulatedAfter: String(row.accumulated_after),
    isFinalPeriod: row.is_final_period as boolean,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

/** Thrown when a book or run write violates a closed invariant. */
export class AssetBookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetBookError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

export class PgAssetBookRepository {
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
  // Asset books
  // ------------------------------------------------------------------

  async createBook(input: {
    tenantId: string;
    legalEntityId: string;
    ledgerId: string;
    assetId: string;
    bookCode: string;
    assetClass: string;
    capitalizationDate: string;
    inServiceDate: string;
    acquisitionCost: string;
    residualValue: string;
    usefulLifeMonths: number;
    methodCode: string;
    methodVersion: number;
    depreciationExpenseAccountId: string;
    accumulatedDepreciationAccountId: string;
    createdBy: string | null;
  }): Promise<AssetBook> {
    try {
      const res = await this.pool.query(
        `INSERT INTO finance_asset_books
           (tenant_id, legal_entity_id, ledger_id, asset_id, book_code, asset_class,
            capitalization_date, in_service_date, acquisition_cost, residual_value,
            useful_life_months, method_code, method_version,
            depreciation_expense_account_id, accumulated_depreciation_account_id,
            created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
         RETURNING *`,
        [
          input.tenantId,
          input.legalEntityId,
          input.ledgerId,
          input.assetId,
          input.bookCode,
          input.assetClass,
          input.capitalizationDate,
          input.inServiceDate,
          input.acquisitionCost,
          input.residualValue,
          input.usefulLifeMonths,
          input.methodCode,
          input.methodVersion,
          input.depreciationExpenseAccountId,
          input.accumulatedDepreciationAccountId,
          input.createdBy,
        ],
      );
      return toBook(res.rows[0]);
    } catch (err) {
      // One book per asset per book code: a second registration is a refusal,
      // not a second book.
      if (isUniqueViolation(err)) {
        throw new AssetBookError("This asset already has a book for that book code");
      }
      throw err;
    }
  }

  async findBookById(tenantId: string, id: string): Promise<AssetBook | null> {
    const res = await this.pool.query(
      `SELECT * FROM finance_asset_books WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return res.rowCount ? toBook(res.rows[0]) : null;
  }

  async listBooks(
    tenantId: string,
    filter: { legalEntityId?: string; bookCode?: string; status?: AssetBookStatus },
  ): Promise<AssetBook[]> {
    const clauses = ["tenant_id = $1"];
    const params: unknown[] = [tenantId];
    if (filter.legalEntityId) {
      params.push(filter.legalEntityId);
      clauses.push(`legal_entity_id = $${params.length}`);
    }
    if (filter.bookCode) {
      params.push(filter.bookCode);
      clauses.push(`book_code = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      clauses.push(`status = $${params.length}`);
    }
    const res = await this.pool.query(
      `SELECT * FROM finance_asset_books WHERE ${clauses.join(" AND ")}
        ORDER BY capitalization_date, book_code`,
      params,
    );
    return res.rows.map(toBook);
  }

  /** Draft → active. Idempotent on an already-active book so a retried
   *  activation is not an error. */
  async activateBook(tenantId: string, id: string, updatedBy: string | null): Promise<AssetBook | null> {
    const res = await this.pool.query(
      `UPDATE finance_asset_books
          SET status = 'active', updated_by = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'draft'
        RETURNING *`,
      [tenantId, id, updatedBy],
    );
    if (res.rowCount) return toBook(res.rows[0]);
    const existing = await this.findBookById(tenantId, id);
    if (!existing) return null;
    if (existing.status === "active") return existing;
    throw new AssetBookError("Only a draft book can be activated");
  }

  async markDisposed(
    tenantId: string,
    id: string,
    disposedAt: string,
    updatedBy: string | null,
  ): Promise<AssetBook | null> {
    const res = await this.pool.query(
      `UPDATE finance_asset_books
          SET status = 'disposed', disposed_at = $3, updated_by = $4, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'active'
        RETURNING *`,
      [tenantId, id, disposedAt, updatedBy],
    );
    if (res.rowCount) return toBook(res.rows[0]);
    const existing = await this.findBookById(tenantId, id);
    if (!existing) return null;
    throw new AssetBookError("Only an active book can be disposed");
  }

  // ------------------------------------------------------------------
  // Asset book events (append-only)
  // ------------------------------------------------------------------

  async createEvent(input: {
    tenantId: string;
    assetBookId: string;
    eventType: AssetBookEventType;
    eventDate: string;
    amount: string | null;
    evidenceDocumentId: string | null;
    workflowInstanceId: string | null;
    journalId: string | null;
    reversalOfId: string | null;
    note: string | null;
    idempotencyKey: string;
    createdBy: string | null;
  }): Promise<AssetBookEvent> {
    // Replay before guard: a retried call returns the row it already wrote
    // rather than failing at the unique key.
    const replay = await this.findEventByIdempotencyKey(input.tenantId, input.idempotencyKey);
    if (replay) return replay;

    try {
      const res = await this.pool.query(
        `INSERT INTO finance_asset_book_events
           (tenant_id, asset_book_id, event_type, event_date, amount,
            evidence_document_id, workflow_instance_id, journal_id, reversal_of_id,
            note, idempotency_key, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          input.tenantId,
          input.assetBookId,
          input.eventType,
          input.eventDate,
          input.amount,
          input.evidenceDocumentId,
          input.workflowInstanceId,
          input.journalId,
          input.reversalOfId,
          input.note,
          input.idempotencyKey,
          input.createdBy,
        ],
      );
      return toEvent(res.rows[0]);
    } catch (err) {
      if (isUniqueViolation(err)) {
        const again = await this.findEventByIdempotencyKey(input.tenantId, input.idempotencyKey);
        if (again) return again;
      }
      throw err;
    }
  }

  async findEventByIdempotencyKey(tenantId: string, key: string): Promise<AssetBookEvent | null> {
    const res = await this.pool.query(
      `SELECT * FROM finance_asset_book_events WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, key],
    );
    return res.rowCount ? toEvent(res.rows[0]) : null;
  }

  async listEvents(tenantId: string, assetBookId: string): Promise<AssetBookEvent[]> {
    const res = await this.pool.query(
      `SELECT * FROM finance_asset_book_events
        WHERE tenant_id = $1 AND asset_book_id = $2
        ORDER BY event_date, created_at`,
      [tenantId, assetBookId],
    );
    return res.rows.map(toEvent);
  }

  // ------------------------------------------------------------------
  // Depreciation runs
  // ------------------------------------------------------------------

  async findRunByIdempotencyKey(tenantId: string, key: string): Promise<DepreciationRun | null> {
    const res = await this.pool.query(
      `SELECT * FROM finance_depreciation_runs WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, key],
    );
    return res.rowCount ? toRun(res.rows[0]) : null;
  }

  async findRunById(tenantId: string, id: string): Promise<DepreciationRun | null> {
    const res = await this.pool.query(
      `SELECT * FROM finance_depreciation_runs WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return res.rowCount ? toRun(res.rows[0]) : null;
  }

  async listRuns(
    tenantId: string,
    filter: { legalEntityId?: string; bookCode?: string; periodId?: string },
  ): Promise<DepreciationRun[]> {
    const clauses = ["tenant_id = $1"];
    const params: unknown[] = [tenantId];
    for (const [column, value] of [
      ["legal_entity_id", filter.legalEntityId],
      ["book_code", filter.bookCode],
      ["period_id", filter.periodId],
    ] as const) {
      if (value) {
        params.push(value);
        clauses.push(`${column} = $${params.length}`);
      }
    }
    const res = await this.pool.query(
      `SELECT * FROM finance_depreciation_runs WHERE ${clauses.join(" AND ")}
        ORDER BY created_at DESC`,
      params,
    );
    return res.rows.map(toRun);
  }

  async getRunDetail(tenantId: string, id: string): Promise<DepreciationRunDetail | null> {
    const run = await this.findRunById(tenantId, id);
    if (!run) return null;
    const res = await this.pool.query(
      `SELECT * FROM finance_depreciation_run_lines
        WHERE tenant_id = $1 AND run_id = $2
        ORDER BY created_at, id`,
      [tenantId, id],
    );
    return { ...run, lines: res.rows.map(toRunLine) };
  }

  /**
   * Compute what a run would post, without writing anything. Split out so the
   * service can show a preview and so the transaction below stays about the
   * write.
   *
   * Each candidate's `alreadyDepreciated` is the sum of its *posted* run lines,
   * so a run that follows a reversal continues the schedule instead of
   * restarting it.
   */
  async planRun(
    tenantId: string,
    input: { legalEntityId: string; bookCode: string; asOfPeriodStart: string },
  ): Promise<
    Array<{
      book: AssetBook;
      amount: bigint;
      accumulatedBefore: bigint;
      accumulatedAfter: bigint;
      isFinalPeriod: boolean;
    }>
  > {
    const res = await this.pool.query(
      `SELECT b.*,
              COALESCE((
                SELECT SUM(l.amount)
                  FROM finance_depreciation_run_lines l
                  JOIN finance_depreciation_runs r ON r.id = l.run_id AND r.tenant_id = l.tenant_id
                 WHERE l.tenant_id = b.tenant_id
                   AND l.asset_book_id = b.id
                   AND r.status = 'posted'
              ), 0)::numeric(18,2) AS already_depreciated
         FROM finance_asset_books b
        WHERE b.tenant_id = $1
          AND b.legal_entity_id = $2
          AND b.book_code = $3
          AND b.status = 'active'
          AND b.in_service_date <= $4::date
        ORDER BY b.capitalization_date, b.id`,
      [tenantId, input.legalEntityId, input.bookCode, input.asOfPeriodStart],
    );

    const out: Array<{
      book: AssetBook;
      amount: bigint;
      accumulatedBefore: bigint;
      accumulatedAfter: bigint;
      isFinalPeriod: boolean;
    }> = [];
    for (const row of res.rows) {
      const book = toBook(row);
      const already = toCents(String(row.already_depreciated)) ?? 0n;
      const schedule = computeSchedule({
        acquisitionCost: book.acquisitionCost,
        residualValue: book.residualValue,
        usefulLifeMonths: book.usefulLifeMonths,
        methodCode: book.methodCode,
        methodVersion: book.methodVersion,
      });
      const step = periodAmount(schedule, already);
      // An exhausted schedule contributes nothing; skipping it keeps the run
      // from carrying zero-amount lines the ledger would reject anyway.
      if (!step || step.amount <= 0n) continue;
      out.push({ book, ...step });
    }
    return out;
  }

  /**
   * Write the run, its lines and the accumulated-depreciation projection in one
   * transaction. The caller posts the journal; this only records the plan.
   */
  async createRun(
    tenantId: string,
    input: {
      legalEntityId: string;
      bookCode: string;
      periodId: string;
      idempotencyKey: string;
      currency: string;
      reversesRunId: string | null;
      createdBy: string | null;
      lines: ReadonlyArray<{
        assetBookId: string;
        amount: string;
        accumulatedBefore: string;
        accumulatedAfter: string;
        isFinalPeriod: boolean;
      }>;
    },
  ): Promise<DepreciationRunDetail> {
    const total = input.lines.reduce((sum, line) => sum + (toCents(line.amount) ?? 0n), 0n);

    try {
      return await this.inTransaction(async (client) => {
      const runRes = await client.query(
        `INSERT INTO finance_depreciation_runs
           (tenant_id, legal_entity_id, book_code, period_id, status, total_amount,
            currency, reverses_run_id, idempotency_key, created_by)
         VALUES ($1,$2,$3,$4,'posted',$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          tenantId,
          input.legalEntityId,
          input.bookCode,
          input.periodId,
          fromCents(total),
          input.currency,
          input.reversesRunId,
          input.idempotencyKey,
          input.createdBy,
        ],
      );
      const run = toRun(runRes.rows[0]);

      const lines: DepreciationRunLine[] = [];
      for (const line of input.lines) {
        const lineRes = await client.query(
          `INSERT INTO finance_depreciation_run_lines
             (tenant_id, run_id, asset_book_id, amount, accumulated_before,
              accumulated_after, is_final_period)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [
            tenantId,
            run.id,
            line.assetBookId,
            line.amount,
            line.accumulatedBefore,
            line.accumulatedAfter,
            line.isFinalPeriod,
          ],
        );
        lines.push(toRunLine(lineRes.rows[0]));

        // Projection only — the run lines are the record of truth.
        await client.query(
          `UPDATE finance_asset_books
              SET accumulated_depreciation = $3, updated_at = now()
            WHERE tenant_id = $1 AND id = $2`,
          [tenantId, line.assetBookId, line.accumulatedAfter],
        );
      }

      return { ...run, lines };
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new AssetBookError("A depreciation run already exists for this book and period");
      }
      throw error;
    }
  }

  /** Attach the journal a run posted. Separate from `createRun` because the
   *  kernel posts the journal after the plan is written. */
  async attachJournal(tenantId: string, runId: string, journalId: string): Promise<void> {
    await this.pool.query(
      `UPDATE finance_depreciation_runs SET journal_id = $3 WHERE tenant_id = $1 AND id = $2`,
      [tenantId, runId, journalId],
    );
  }

  /** A run is reversed by a linked run; the original stays and flips to
   *  `reversed` so it cannot be reversed twice. */
  async markRunReversed(tenantId: string, runId: string): Promise<void> {
    const res = await this.pool.query(
      `UPDATE finance_depreciation_runs
          SET status = 'reversed'
        WHERE tenant_id = $1 AND id = $2 AND status = 'posted'`,
      [tenantId, runId],
    );
    if (!res.rowCount) throw new AssetBookError("Run is already reversed");
  }

  /** Journal a reversal run should post: each line's amount negated. */
  async reversalLines(tenantId: string, runId: string): Promise<DepreciationRunLine[]> {
    const res = await this.pool.query(
      `SELECT * FROM finance_depreciation_run_lines
        WHERE tenant_id = $1 AND run_id = $2
        ORDER BY created_at, id`,
      [tenantId, runId],
    );
    return res.rows.map(toRunLine);
  }

  /** Accounts a run's journal legs use, per book, so the caller can build
   *  balanced lines. Grouped by account because one journal carries them all. */
  async journalAccounts(
    tenantId: string,
    assetBookIds: string[],
  ): Promise<
    Array<{
      assetBookId: string;
      depreciationExpenseAccountId: string;
      accumulatedDepreciationAccountId: string;
    }>
  > {
    if (assetBookIds.length === 0) return [];
    const res = await this.pool.query(
      `SELECT id, depreciation_expense_account_id, accumulated_depreciation_account_id
         FROM finance_asset_books
        WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, assetBookIds],
    );
    return res.rows.map((row) => ({
      assetBookId: row.id as string,
      depreciationExpenseAccountId: row.depreciation_expense_account_id as string,
      accumulatedDepreciationAccountId: row.accumulated_depreciation_account_id as string,
    }));
  }

  /** Active book count for one legal entity + book code, used by the service to
   *  distinguish "nothing to depreciate" from "no such book". */
  async countActiveBooks(tenantId: string, legalEntityId: string, bookCode: string): Promise<number> {
    const res = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM finance_asset_books
        WHERE tenant_id = $1 AND legal_entity_id = $2 AND book_code = $3 AND status = 'active'`,
      [tenantId, legalEntityId, bookCode],
    );
    return Number(res.rows[0].n);
  }

  /** Period window + state. Read here rather than through the kernel: the
   *  service needs the period's start date, not a second authorization gate. */
  async periodInfo(
    tenantId: string,
    periodId: string,
  ): Promise<{ dateFrom: string; dateTo: string; status: string } | null> {
    const res = await this.pool.query(
      `SELECT date_from, date_to, status FROM accounting_periods
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, periodId],
    );
    if (!res.rowCount) return null;
    return {
      dateFrom: toDateStr(res.rows[0].date_from),
      dateTo: toDateStr(res.rows[0].date_to),
      status: res.rows[0].status as string,
    };
  }
}
