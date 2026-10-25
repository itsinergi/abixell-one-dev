import type { Pool, PoolClient } from "pg";
import {
  type ConsolidationGroup,
  type ConsolidationGroupEntity,
  type ConsolidationGroupStatus,
  type Elimination,
  type EliminationStatus,
  type FsvLine,
  type FsvVersion,
  type FsvVersionStatus,
  type FxRate,
  type FxRateSet,
  type LineSign,
  type RateType,
  type StatementType,
  type TranslationRun,
  type TranslationRunLine,
  type TranslationRunStatus,
  fromCents,
  fromRateUnits,
  toCents,
  toRateUnits,
} from "../domain/consolidation.entity.js";

type Row = Record<string, unknown>;

/** `date` columns arrive as local-midnight Date objects; a calendar date has no
 *  timezone, so read the local components rather than `toISOString()`. */
function toDateStr(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

function toGroup(row: Row): ConsolidationGroup {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    groupCode: row.group_code as string,
    name: row.name as string,
    reportingCurrency: row.reporting_currency as string,
    translationDifferenceAccountId: (row.translation_difference_account_id as string | null) ?? null,
    status: row.status as ConsolidationGroupStatus,
    workflowInstanceId: (row.workflow_instance_id as string | null) ?? null,
    approvedBy: (row.approved_by as string | null) ?? null,
    approvedAt: row.approved_at ? (row.approved_at as Date).toISOString() : null,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

function toMember(row: Row): ConsolidationGroupEntity {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    groupId: row.group_id as string,
    legalEntityId: row.legal_entity_id as string,
    effectiveFrom: toDateStr(row.effective_from),
    effectiveTo: row.effective_to ? toDateStr(row.effective_to) : null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

function toFsvVersion(row: Row): FsvVersion {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    fsvCode: row.fsv_code as string,
    versionNumber: Number(row.version_number),
    description: (row.description as string | null) ?? null,
    status: row.status as FsvVersionStatus,
    effectiveFrom: toDateStr(row.effective_from),
    effectiveTo: row.effective_to ? toDateStr(row.effective_to) : null,
    workflowInstanceId: (row.workflow_instance_id as string | null) ?? null,
    approvedBy: (row.approved_by as string | null) ?? null,
    approvedAt: row.approved_at ? (row.approved_at as Date).toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

function toFsvLine(row: Row): FsvLine {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    fsvVersionId: row.fsv_version_id as string,
    lineCode: row.line_code as string,
    lineName: row.line_name as string,
    statementType: row.statement_type as StatementType,
    accountId: (row.account_id as string | null) ?? null,
    sign: row.sign as LineSign,
    sequenceOrder: Number(row.sequence_order),
    parentLineCode: (row.parent_line_code as string | null) ?? null,
  };
}

function toRateSet(row: Row): FxRateSet {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    setCode: row.set_code as string,
    name: row.name as string,
    effectiveFrom: toDateStr(row.effective_from),
    effectiveTo: row.effective_to ? toDateStr(row.effective_to) : null,
    status: row.status as "active" | "archived",
    createdAt: (row.created_at as Date).toISOString(),
  };
}

function toRate(row: Row): FxRate {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    rateSetId: row.rate_set_id as string,
    fromCurrency: row.from_currency as string,
    toCurrency: row.to_currency as string,
    rateType: row.rate_type as RateType,
    rate: String(row.rate),
  };
}

function toRun(row: Row): TranslationRun {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    groupId: row.group_id as string,
    periodId: row.period_id as string,
    rateSetId: row.rate_set_id as string,
    fsvVersionId: row.fsv_version_id as string,
    reportingCurrency: row.reporting_currency as string,
    translatedTotal: String(row.translated_total),
    residualAmount: String(row.residual_amount),
    status: row.status as TranslationRunStatus,
    journalId: (row.journal_id as string | null) ?? null,
    idempotencyKey: row.idempotency_key as string,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

function toRunLine(row: Row): TranslationRunLine {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    runId: row.run_id as string,
    legalEntityId: row.legal_entity_id as string,
    accountId: row.account_id as string,
    sourceCurrency: row.source_currency as string,
    sourceAmount: String(row.source_amount),
    rate: String(row.rate),
    rateType: row.rate_type as RateType,
    translatedAmount: String(row.translated_amount),
  };
}

function toElimination(row: Row): Elimination {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    groupId: row.group_id as string,
    periodId: row.period_id as string,
    description: row.description as string,
    amount: String(row.amount),
    currency: row.currency as string,
    journalId: (row.journal_id as string | null) ?? null,
    status: row.status as EliminationStatus,
    workflowInstanceId: (row.workflow_instance_id as string | null) ?? null,
    approvedBy: (row.approved_by as string | null) ?? null,
    approvedAt: row.approved_at ? (row.approved_at as Date).toISOString() : null,
    idempotencyKey: row.idempotency_key as string,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

/** Thrown when a consolidation write violates a closed invariant. */
export class ConsolidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsolidationError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

/** A trial balance figure per account for one Legal Entity over one period. */
export interface AccountBalanceFact {
  accountId: string;
  /** `accounting_accounts.account_class`: ASSET, LIABILITY, INCOME, EXPENSE. */
  accountType: string;
  /** `debit` or `credit` — which side a positive balance sits on. */
  normalBalance: string;
  currency: string;
  /** Raw `debit - credit`, signed debit-positive. Normalising by account class
   *  is the statement layer's job, not this read's. */
  netAmount: string;
}

export class PgConsolidationRepository {
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
  // Groups
  // ------------------------------------------------------------------

  async createGroup(input: {
    tenantId: string;
    groupCode: string;
    name: string;
    reportingCurrency: string;
    translationDifferenceAccountId: string | null;
    createdBy: string | null;
  }): Promise<ConsolidationGroup> {
    try {
      const res = await this.pool.query(
        `INSERT INTO finance_consolidation_groups
           (tenant_id, group_code, name, reporting_currency,
            translation_difference_account_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [
          input.tenantId,
          input.groupCode,
          input.name,
          input.reportingCurrency,
          input.translationDifferenceAccountId,
          input.createdBy,
        ],
      );
      return toGroup(res.rows[0]);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConsolidationError(`A consolidation group with code "${input.groupCode}" already exists`);
      }
      throw err;
    }
  }

  async findGroupById(tenantId: string, id: string): Promise<ConsolidationGroup | null> {
    const res = await this.pool.query(
      `SELECT * FROM finance_consolidation_groups WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return res.rows[0] ? toGroup(res.rows[0]) : null;
  }

  async listGroups(tenantId: string): Promise<ConsolidationGroup[]> {
    const res = await this.pool.query(
      `SELECT * FROM finance_consolidation_groups WHERE tenant_id = $1 ORDER BY group_code`,
      [tenantId],
    );
    return res.rows.map(toGroup);
  }

  async setGroupWorkflowInstance(
    tenantId: string,
    groupId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE finance_consolidation_groups
          SET workflow_instance_id = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, groupId, workflowInstanceId],
    );
  }

  /** Activate a group once its workflow approved. Activation is the only
   *  lifecycle write; the perimeter itself is never edited. */
  async activateGroup(
    tenantId: string,
    groupId: string,
    approvedBy: string,
  ): Promise<ConsolidationGroup | null> {
    return this.inTransaction(async (client) => {
      const found = await client.query(
        `SELECT * FROM finance_consolidation_groups WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, groupId],
      );
      if (!found.rows[0]) return null;
      const group = toGroup(found.rows[0]);
      if (group.status !== "draft") {
        throw new ConsolidationError("Only a draft consolidation group can be activated");
      }
      const res = await client.query(
        `UPDATE finance_consolidation_groups
            SET status = 'active', approved_by = $3, approved_at = now(), updated_at = now()
          WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, groupId, approvedBy],
      );
      return toGroup(res.rows[0]);
    });
  }

  // ------------------------------------------------------------------
  // Membership
  // ------------------------------------------------------------------

  /**
   * Add an entity to the group from `effectiveFrom`, closing any open row for
   * that entity at the same instant. A date is never covered by two rows.
   */
  async addMember(input: {
    tenantId: string;
    groupId: string;
    legalEntityId: string;
    effectiveFrom: string;
    createdBy: string | null;
  }): Promise<ConsolidationGroupEntity> {
    return this.inTransaction(async (client) => {
      await client.query(
        `UPDATE finance_consolidation_group_entities
            SET effective_to = $4
          WHERE tenant_id = $1 AND group_id = $2 AND legal_entity_id = $3
            AND effective_to IS NULL`,
        [input.tenantId, input.groupId, input.legalEntityId, input.effectiveFrom],
      );
      try {
        const res = await client.query(
          `INSERT INTO finance_consolidation_group_entities
             (tenant_id, group_id, legal_entity_id, effective_from, created_by)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [input.tenantId, input.groupId, input.legalEntityId, input.effectiveFrom, input.createdBy],
        );
        return toMember(res.rows[0]);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConsolidationError("That entity already joins the group on that effective date");
        }
        throw err;
      }
    });
  }

  /** Remove an entity by closing its open membership — never by deleting it. */
  async removeMember(
    tenantId: string,
    groupId: string,
    legalEntityId: string,
    effectiveTo: string,
  ): Promise<ConsolidationGroupEntity | null> {
    const res = await this.pool.query(
      `UPDATE finance_consolidation_group_entities
          SET effective_to = $4
        WHERE tenant_id = $1 AND group_id = $2 AND legal_entity_id = $3
          AND effective_to IS NULL RETURNING *`,
      [tenantId, groupId, legalEntityId, effectiveTo],
    );
    return res.rows[0] ? toMember(res.rows[0]) : null;
  }

  async listMembers(tenantId: string, groupId: string): Promise<ConsolidationGroupEntity[]> {
    const res = await this.pool.query(
      `SELECT * FROM finance_consolidation_group_entities
        WHERE tenant_id = $1 AND group_id = $2
        ORDER BY effective_from DESC`,
      [tenantId, groupId],
    );
    return res.rows.map(toMember);
  }

  // ------------------------------------------------------------------
  // FSV
  // ------------------------------------------------------------------

  async createFsvVersion(input: {
    tenantId: string;
    fsvCode: string;
    description: string | null;
    effectiveFrom: string;
    effectiveTo: string | null;
    lines: Array<{
      lineCode: string;
      lineName: string;
      statementType: StatementType;
      accountId: string | null;
      sign: LineSign;
      sequenceOrder: number;
      parentLineCode: string | null;
    }>;
    createdBy: string | null;
  }): Promise<{ version: FsvVersion; lines: FsvLine[] }> {
    return this.inTransaction(async (client) => {
      // Serialise version numbering per FSV code on a stable lock. `FOR UPDATE`
      // cannot sit beside an aggregate, so the code is locked through the rows
      // that already carry it.
      await client.query(
        `SELECT id FROM finance_fsv_versions
          WHERE tenant_id = $1 AND fsv_code = $2 FOR UPDATE`,
        [input.tenantId, input.fsvCode],
      );
      const next = await client.query(
        `SELECT COALESCE(MAX(version_number), 0) + 1 AS n
           FROM finance_fsv_versions WHERE tenant_id = $1 AND fsv_code = $2`,
        [input.tenantId, input.fsvCode],
      );
      const versionRes = await client.query(
        `INSERT INTO finance_fsv_versions
           (tenant_id, fsv_code, version_number, description, effective_from, effective_to, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          input.tenantId,
          input.fsvCode,
          Number(next.rows[0].n),
          input.description,
          input.effectiveFrom,
          input.effectiveTo,
          input.createdBy,
        ],
      );
      const version = toFsvVersion(versionRes.rows[0]);

      const lines: FsvLine[] = [];
      for (const line of input.lines) {
        const res = await client.query(
          `INSERT INTO finance_fsv_lines
             (tenant_id, fsv_version_id, line_code, line_name, statement_type,
              account_id, sign, sequence_order, parent_line_code)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            input.tenantId,
            version.id,
            line.lineCode,
            line.lineName,
            line.statementType,
            line.accountId,
            line.sign,
            line.sequenceOrder,
            line.parentLineCode,
          ],
        );
        lines.push(toFsvLine(res.rows[0]));
      }
      return { version, lines };
    });
  }

  async findFsvVersionById(tenantId: string, id: string): Promise<FsvVersion | null> {
    const res = await this.pool.query(
      `SELECT * FROM finance_fsv_versions WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return res.rows[0] ? toFsvVersion(res.rows[0]) : null;
  }

  async listFsvVersions(tenantId: string, fsvCode?: string): Promise<FsvVersion[]> {
    const res = fsvCode
      ? await this.pool.query(
          `SELECT * FROM finance_fsv_versions
            WHERE tenant_id = $1 AND fsv_code = $2 ORDER BY version_number`,
          [tenantId, fsvCode],
        )
      : await this.pool.query(
          `SELECT * FROM finance_fsv_versions WHERE tenant_id = $1 ORDER BY fsv_code, version_number`,
          [tenantId],
        );
    return res.rows.map(toFsvVersion);
  }

  async listFsvLines(tenantId: string, fsvVersionId: string): Promise<FsvLine[]> {
    const res = await this.pool.query(
      `SELECT * FROM finance_fsv_lines
        WHERE tenant_id = $1 AND fsv_version_id = $2
        ORDER BY statement_type, sequence_order, line_code`,
      [tenantId, fsvVersionId],
    );
    return res.rows.map(toFsvLine);
  }

  async setFsvWorkflowInstance(
    tenantId: string,
    fsvVersionId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE finance_fsv_versions SET workflow_instance_id = $3
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, fsvVersionId, workflowInstanceId],
    );
  }

  /** Approve a draft FSV version and supersede the one it replaces. */
  async approveFsvVersion(
    tenantId: string,
    fsvVersionId: string,
    approvedBy: string,
  ): Promise<FsvVersion | null> {
    return this.inTransaction(async (client) => {
      const found = await client.query(
        `SELECT * FROM finance_fsv_versions WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, fsvVersionId],
      );
      if (!found.rows[0]) return null;
      const version = toFsvVersion(found.rows[0]);
      if (version.status !== "draft") {
        throw new ConsolidationError("Only a draft FSV version can be approved");
      }
      await client.query(
        `UPDATE finance_fsv_versions
            SET status = 'superseded', effective_to = $4
          WHERE tenant_id = $1 AND fsv_code = $2 AND id <> $3
            AND status = 'approved' AND effective_to IS NULL
            AND effective_from < $4`,
        [tenantId, version.fsvCode, fsvVersionId, version.effectiveFrom],
      );
      const res = await client.query(
        `UPDATE finance_fsv_versions
            SET status = 'approved', approved_by = $3, approved_at = now()
          WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, fsvVersionId, approvedBy],
      );
      return toFsvVersion(res.rows[0]);
    });
  }

  // ------------------------------------------------------------------
  // FX rate sets
  // ------------------------------------------------------------------

  async createRateSet(input: {
    tenantId: string;
    setCode: string;
    name: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    rates: Array<{
      fromCurrency: string;
      toCurrency: string;
      rateType: RateType;
      rate: string;
    }>;
    createdBy: string | null;
  }): Promise<{ set: FxRateSet; rates: FxRate[] }> {
    return this.inTransaction(async (client) => {
      let setRes;
      try {
        setRes = await client.query(
          `INSERT INTO finance_fx_rate_sets
             (tenant_id, set_code, name, effective_from, effective_to, created_by)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [
            input.tenantId,
            input.setCode,
            input.name,
            input.effectiveFrom,
            input.effectiveTo,
            input.createdBy,
          ],
        );
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConsolidationError(
            `A rate set "${input.setCode}" already starts on ${input.effectiveFrom}`,
          );
        }
        throw err;
      }
      const set = toRateSet(setRes.rows[0]);

      const rates: FxRate[] = [];
      for (const rate of input.rates) {
        const units = toRateUnits(rate.rate);
        if (units === null || units <= 0n) {
          throw new ConsolidationError("rate must be a positive decimal with at most 8 decimals");
        }
        const res = await client.query(
          `INSERT INTO finance_fx_rates
             (tenant_id, rate_set_id, from_currency, to_currency, rate_type, rate)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [
            input.tenantId,
            set.id,
            rate.fromCurrency,
            rate.toCurrency,
            rate.rateType,
            fromRateUnits(units),
          ],
        );
        rates.push(toRate(res.rows[0]));
      }
      return { set, rates };
    });
  }

  async findRateSetById(tenantId: string, id: string): Promise<FxRateSet | null> {
    const res = await this.pool.query(
      `SELECT * FROM finance_fx_rate_sets WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return res.rows[0] ? toRateSet(res.rows[0]) : null;
  }

  async listRateSets(tenantId: string): Promise<FxRateSet[]> {
    const res = await this.pool.query(
      `SELECT * FROM finance_fx_rate_sets WHERE tenant_id = $1
        ORDER BY set_code, effective_from DESC`,
      [tenantId],
    );
    return res.rows.map(toRateSet);
  }

  async listRates(tenantId: string, rateSetId: string): Promise<FxRate[]> {
    const res = await this.pool.query(
      `SELECT * FROM finance_fx_rates WHERE tenant_id = $1 AND rate_set_id = $2
        ORDER BY from_currency, to_currency, rate_type`,
      [tenantId, rateSetId],
    );
    return res.rows.map(toRate);
  }

  // ------------------------------------------------------------------
  // Ledger facts
  // ------------------------------------------------------------------

  /** The period's date window and lifecycle, for the closed-period check. */
  async periodInfo(
    tenantId: string,
    periodId: string,
  ): Promise<{ id: string; dateFrom: string; dateTo: string; status: string } | null> {
    const res = await this.pool.query(
      `SELECT id, date_from, date_to, status FROM accounting_periods
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, periodId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      id: row.id as string,
      dateFrom: toDateStr(row.date_from),
      dateTo: toDateStr(row.date_to),
      status: row.status as string,
    };
  }

  /**
   * Posted balances per account for one Legal Entity over one date range, read
   * from `journal_lines` joined to its posted header. Read-only: this module
   * never writes the GL, which is what keeps the Accounting Kernel the sole
   * writer (ADR-0023).
   *
   * Only `posted` headers count — a draft journal is not a fact, and a reversed
   * one is netted out by its own reversal lines rather than filtered, so the
   * arithmetic stays additive.
   */
  async accountBalancesForPeriod(
    tenantId: string,
    legalEntityId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<AccountBalanceFact[]> {
    const res = await this.pool.query(
      `SELECT l.account_id,
              a.account_class,
              a.normal_balance,
              le.base_currency AS currency,
              SUM(l.debit - l.credit)::numeric(18,2) AS net_amount
         FROM journal_lines l
         JOIN journal_headers h
           ON h.tenant_id = l.tenant_id AND h.id = l.journal_header_id
         JOIN accounting_accounts a
           ON a.tenant_id = l.tenant_id AND a.id = l.account_id
         JOIN legal_entities le
           ON le.tenant_id = h.tenant_id AND le.id = h.legal_entity_id
        WHERE l.tenant_id = $1
          AND h.legal_entity_id = $2
          AND h.status = 'posted'
          AND h.accounting_date >= $3
          AND h.accounting_date <= $4
        GROUP BY l.account_id, a.account_class, a.normal_balance, le.base_currency
        ORDER BY l.account_id`,
      [tenantId, legalEntityId, periodStart, periodEnd],
    );
    return res.rows.map((row) => ({
      accountId: row.account_id as string,
      accountType: row.account_class as string,
      normalBalance: row.normal_balance as string,
      currency: (row.currency as string | null) ?? "IDR",
      netAmount: String(row.net_amount),
    }));
  }

  // ------------------------------------------------------------------
  // Translation runs
  // ------------------------------------------------------------------

  async findRunByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<TranslationRun | null> {
    const res = await this.pool.query(
      `SELECT * FROM finance_translation_runs WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, idempotencyKey],
    );
    return res.rows[0] ? toRun(res.rows[0]) : null;
  }

  async findRunById(tenantId: string, id: string): Promise<TranslationRun | null> {
    const res = await this.pool.query(
      `SELECT * FROM finance_translation_runs WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return res.rows[0] ? toRun(res.rows[0]) : null;
  }

  async listRuns(
    tenantId: string,
    filter: { groupId?: string; periodId?: string },
  ): Promise<TranslationRun[]> {
    const clauses = ["tenant_id = $1"];
    const params: unknown[] = [tenantId];
    if (filter.groupId) {
      params.push(filter.groupId);
      clauses.push(`group_id = $${params.length}`);
    }
    if (filter.periodId) {
      params.push(filter.periodId);
      clauses.push(`period_id = $${params.length}`);
    }
    const res = await this.pool.query(
      `SELECT * FROM finance_translation_runs WHERE ${clauses.join(" AND ")}
        ORDER BY created_at DESC`,
      params,
    );
    return res.rows.map(toRun);
  }

  async listRunLines(tenantId: string, runId: string): Promise<TranslationRunLine[]> {
    const res = await this.pool.query(
      `SELECT * FROM finance_translation_run_lines
        WHERE tenant_id = $1 AND run_id = $2
        ORDER BY legal_entity_id, account_id`,
      [tenantId, runId],
    );
    return res.rows.map(toRunLine);
  }

  /**
   * Persist a whole translation run in one transaction: the header and every
   * line, with the rate that produced each figure. A partially written run would
   * be a report that cannot explain itself.
   */
  async createRun(input: {
    tenantId: string;
    groupId: string;
    periodId: string;
    rateSetId: string;
    fsvVersionId: string;
    reportingCurrency: string;
    translatedTotal: string;
    residualAmount: string;
    idempotencyKey: string;
    createdBy: string | null;
    lines: Array<{
      legalEntityId: string;
      accountId: string;
      sourceCurrency: string;
      sourceAmount: string;
      rate: string;
      rateType: RateType;
      translatedAmount: string;
    }>;
  }): Promise<{ run: TranslationRun; lines: TranslationRunLine[] }> {
    const total = toCents(input.translatedTotal);
    const residual = toCents(input.residualAmount);
    if (total === null || residual === null) {
      throw new ConsolidationError("translatedTotal and residualAmount must be 2-decimal money values");
    }

    return this.inTransaction(async (client) => {
      let runRes;
      try {
        runRes = await client.query(
          `INSERT INTO finance_translation_runs
             (tenant_id, group_id, period_id, rate_set_id, fsv_version_id, reporting_currency,
              translated_total, residual_amount, idempotency_key, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [
            input.tenantId,
            input.groupId,
            input.periodId,
            input.rateSetId,
            input.fsvVersionId,
            input.reportingCurrency,
            fromCents(total),
            fromCents(residual),
            input.idempotencyKey,
            input.createdBy,
          ],
        );
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConsolidationError("A translation run with that idempotency key already exists");
        }
        throw err;
      }
      const run = toRun(runRes.rows[0]);

      const lines: TranslationRunLine[] = [];
      for (const line of input.lines) {
        const source = toCents(line.sourceAmount);
        const translated = toCents(line.translatedAmount);
        const units = toRateUnits(line.rate);
        if (source === null || translated === null || units === null) {
          throw new ConsolidationError("Translation line carries an unparseable amount or rate");
        }
        const res = await client.query(
          `INSERT INTO finance_translation_run_lines
             (tenant_id, run_id, legal_entity_id, account_id, source_currency,
              source_amount, rate, rate_type, translated_amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            input.tenantId,
            run.id,
            line.legalEntityId,
            line.accountId,
            line.sourceCurrency,
            fromCents(source),
            fromRateUnits(units),
            line.rateType,
            fromCents(translated),
          ],
        );
        lines.push(toRunLine(res.rows[0]));
      }
      return { run, lines };
    });
  }

  async setRunJournal(
    tenantId: string,
    runId: string,
    journalId: string,
    status: TranslationRunStatus,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE finance_translation_runs SET journal_id = $3, status = $4
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, runId, journalId, status],
    );
  }

  // ------------------------------------------------------------------
  // Eliminations
  // ------------------------------------------------------------------

  async createElimination(input: {
    tenantId: string;
    groupId: string;
    periodId: string;
    description: string;
    amount: string;
    currency: string;
    idempotencyKey: string;
    createdBy: string | null;
  }): Promise<Elimination> {
    const amount = toCents(input.amount);
    if (amount === null || amount <= 0n) {
      throw new ConsolidationError("amount must be a positive 2-decimal money value");
    }
    try {
      const res = await this.pool.query(
        `INSERT INTO finance_eliminations
           (tenant_id, group_id, period_id, description, amount, currency,
            idempotency_key, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          input.tenantId,
          input.groupId,
          input.periodId,
          input.description,
          fromCents(amount),
          input.currency,
          input.idempotencyKey,
          input.createdBy,
        ],
      );
      return toElimination(res.rows[0]);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConsolidationError("An elimination with that idempotency key already exists");
      }
      throw err;
    }
  }

  async findEliminationById(tenantId: string, id: string): Promise<Elimination | null> {
    const res = await this.pool.query(
      `SELECT * FROM finance_eliminations WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return res.rows[0] ? toElimination(res.rows[0]) : null;
  }

  async listEliminations(
    tenantId: string,
    filter: { groupId?: string; periodId?: string },
  ): Promise<Elimination[]> {
    const clauses = ["tenant_id = $1"];
    const params: unknown[] = [tenantId];
    if (filter.groupId) {
      params.push(filter.groupId);
      clauses.push(`group_id = $${params.length}`);
    }
    if (filter.periodId) {
      params.push(filter.periodId);
      clauses.push(`period_id = $${params.length}`);
    }
    const res = await this.pool.query(
      `SELECT * FROM finance_eliminations WHERE ${clauses.join(" AND ")}
        ORDER BY created_at DESC`,
      params,
    );
    return res.rows.map(toElimination);
  }

  async setEliminationWorkflowInstance(
    tenantId: string,
    eliminationId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE finance_eliminations SET workflow_instance_id = $3
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, eliminationId, workflowInstanceId],
    );
  }

  /** Approve an elimination. Posting the journal is the caller's job through the
   *  Accounting Kernel — this module has no GL write path (ADR-0023). */
  async approveElimination(
    tenantId: string,
    eliminationId: string,
    approvedBy: string,
  ): Promise<Elimination | null> {
    return this.inTransaction(async (client) => {
      const found = await client.query(
        `SELECT * FROM finance_eliminations WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, eliminationId],
      );
      if (!found.rows[0]) return null;
      const elimination = toElimination(found.rows[0]);
      if (elimination.status !== "draft") {
        throw new ConsolidationError("Only a draft elimination can be approved");
      }
      const res = await client.query(
        `UPDATE finance_eliminations
            SET status = 'approved', approved_by = $3, approved_at = now()
          WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, eliminationId, approvedBy],
      );
      return toElimination(res.rows[0]);
    });
  }

  async markEliminationPosted(
    tenantId: string,
    eliminationId: string,
    journalId: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE finance_eliminations SET status = 'posted', journal_id = $3
        WHERE tenant_id = $1 AND id = $2 AND status = 'approved'`,
      [tenantId, eliminationId, journalId],
    );
  }
}
