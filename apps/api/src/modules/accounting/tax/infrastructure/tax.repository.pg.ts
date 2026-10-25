import type { Pool, PoolClient } from "pg";
import {
  type RoundingMode,
  type TaxBasis,
  type TaxCalculation,
  type TaxRegistration,
  type TaxRule,
  type TaxRuleVersion,
  type TaxRuleVersionStatus,
  type TaxType,
  type TaxpayerStatus,
  fromCents,
  fromRateMicros,
  toCents,
  toRateMicros,
} from "../domain/tax.entity.js";

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

function toRegistration(row: Row): TaxRegistration {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    legalEntityId: row.legal_entity_id as string,
    taxpayerStatus: row.taxpayer_status as TaxpayerStatus,
    registrationNumber: (row.registration_number as string | null) ?? null,
    effectiveFrom: toDateStr(row.effective_from),
    effectiveTo: row.effective_to ? toDateStr(row.effective_to) : null,
    evidenceDocumentId: (row.evidence_document_id as string | null) ?? null,
    status: row.status as "active" | "superseded",
    workflowInstanceId: (row.workflow_instance_id as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

function toRule(row: Row): TaxRule {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    legalEntityId: row.legal_entity_id as string,
    ruleCode: row.rule_code as string,
    taxType: row.tax_type as TaxType,
    description: (row.description as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

function toVersion(row: Row): TaxRuleVersion {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    taxRuleId: row.tax_rule_id as string,
    versionNumber: Number(row.version_number),
    rate: String(row.rate),
    basis: row.basis as TaxBasis,
    roundingMode: row.rounding_mode as RoundingMode,
    requiresPkp: row.requires_pkp as boolean,
    accountId: row.account_id as string,
    effectiveFrom: toDateStr(row.effective_from),
    effectiveTo: row.effective_to ? toDateStr(row.effective_to) : null,
    status: row.status as TaxRuleVersionStatus,
    workflowInstanceId: (row.workflow_instance_id as string | null) ?? null,
    approvedBy: (row.approved_by as string | null) ?? null,
    approvedAt: row.approved_at ? (row.approved_at as Date).toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

function toCalculation(row: Row): TaxCalculation {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    legalEntityId: row.legal_entity_id as string,
    ruleVersionId: row.rule_version_id as string,
    taxpayerStatus: row.taxpayer_status as TaxpayerStatus,
    basisAmount: String(row.basis_amount),
    rate: String(row.rate),
    roundingMode: row.rounding_mode as RoundingMode,
    taxAmount: String(row.tax_amount),
    currency: row.currency as string,
    calculationDate: toDateStr(row.calculation_date),
    documentRefTable: (row.document_ref_table as string | null) ?? null,
    documentRefId: (row.document_ref_id as string | null) ?? null,
    idempotencyKey: row.idempotency_key as string,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

/** Thrown when a tax write violates a closed invariant. */
export class TaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

export class PgTaxRepository {
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
  // Registrations
  // ------------------------------------------------------------------

  async createRegistration(input: {
    tenantId: string;
    legalEntityId: string;
    taxpayerStatus: TaxpayerStatus;
    registrationNumber: string | null;
    effectiveFrom: string;
    evidenceDocumentId: string | null;
    createdBy: string | null;
  }): Promise<TaxRegistration> {
    try {
      const res = await this.pool.query(
        `INSERT INTO finance_tax_registrations
           (tenant_id, legal_entity_id, taxpayer_status, registration_number,
            effective_from, evidence_document_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          input.tenantId,
          input.legalEntityId,
          input.taxpayerStatus,
          input.registrationNumber,
          input.effectiveFrom,
          input.evidenceDocumentId,
          input.createdBy,
        ],
      );
      return toRegistration(res.rows[0]);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new TaxError("A registration already exists for that Legal Entity and effective date");
      }
      throw err;
    }
  }

  /**
   * Close the currently-open registration and open the new one in a single
   * transaction, so no date is ever covered by two statuses or by none.
   */
  async supersedeRegistration(input: {
    tenantId: string;
    legalEntityId: string;
    taxpayerStatus: TaxpayerStatus;
    registrationNumber: string | null;
    effectiveFrom: string;
    evidenceDocumentId: string | null;
    createdBy: string | null;
  }): Promise<TaxRegistration> {
    return this.inTransaction(async (client) => {
      await client.query(
        `UPDATE finance_tax_registrations
            SET status = 'superseded', effective_to = $3
          WHERE tenant_id = $1 AND legal_entity_id = $2
            AND status = 'active' AND effective_to IS NULL`,
        [input.tenantId, input.legalEntityId, input.effectiveFrom],
      );
      const res = await client.query(
        `INSERT INTO finance_tax_registrations
           (tenant_id, legal_entity_id, taxpayer_status, registration_number,
            effective_from, evidence_document_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          input.tenantId,
          input.legalEntityId,
          input.taxpayerStatus,
          input.registrationNumber,
          input.effectiveFrom,
          input.evidenceDocumentId,
          input.createdBy,
        ],
      );
      return toRegistration(res.rows[0]);
    });
  }

  async listRegistrations(tenantId: string, legalEntityId: string): Promise<TaxRegistration[]> {
    const res = await this.pool.query(
      `SELECT * FROM finance_tax_registrations
        WHERE tenant_id = $1 AND legal_entity_id = $2
        ORDER BY effective_from DESC`,
      [tenantId, legalEntityId],
    );
    return res.rows.map(toRegistration);
  }

  async findRegistrationById(tenantId: string, id: string): Promise<TaxRegistration | null> {
    const res = await this.pool.query(
      `SELECT * FROM finance_tax_registrations WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return res.rows[0] ? toRegistration(res.rows[0]) : null;
  }

  // ------------------------------------------------------------------
  // Rules
  // ------------------------------------------------------------------

  async createRule(input: {
    tenantId: string;
    legalEntityId: string;
    ruleCode: string;
    taxType: TaxType;
    description: string | null;
    createdBy: string | null;
  }): Promise<TaxRule> {
    try {
      const res = await this.pool.query(
        `INSERT INTO finance_tax_rules
           (tenant_id, legal_entity_id, rule_code, tax_type, description, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [input.tenantId, input.legalEntityId, input.ruleCode, input.taxType, input.description, input.createdBy],
      );
      return toRule(res.rows[0]);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new TaxError(`A tax rule with code "${input.ruleCode}" already exists for this Legal Entity`);
      }
      throw err;
    }
  }

  async findRuleById(tenantId: string, id: string): Promise<TaxRule | null> {
    const res = await this.pool.query(
      `SELECT * FROM finance_tax_rules WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return res.rows[0] ? toRule(res.rows[0]) : null;
  }

  async listRules(tenantId: string, legalEntityId?: string): Promise<TaxRule[]> {
    const res = legalEntityId
      ? await this.pool.query(
          `SELECT * FROM finance_tax_rules WHERE tenant_id = $1 AND legal_entity_id = $2
            ORDER BY rule_code`,
          [tenantId, legalEntityId],
        )
      : await this.pool.query(
          `SELECT * FROM finance_tax_rules WHERE tenant_id = $1 ORDER BY rule_code`,
          [tenantId],
        );
    return res.rows.map(toRule);
  }

  // ------------------------------------------------------------------
  // Rule versions
  // ------------------------------------------------------------------

  /** Next version number for a rule. Allocated inside the insert transaction so
   *  two concurrent drafts cannot take the same number. */
  async createVersion(input: {
    tenantId: string;
    taxRuleId: string;
    rate: string;
    basis: TaxBasis;
    roundingMode: RoundingMode;
    requiresPkp: boolean;
    accountId: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    createdBy: string | null;
  }): Promise<TaxRuleVersion> {
    const rateMicros = toRateMicros(input.rate);
    if (rateMicros === null) throw new TaxError("rate must be a 6-decimal fraction");

    return this.inTransaction(async (client) => {
      // Serialise version numbering on the parent rule: `FOR UPDATE` cannot sit
      // beside an aggregate, and the rule row is the natural lock for its own
      // version sequence.
      await client.query(
        `SELECT id FROM finance_tax_rules WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [input.tenantId, input.taxRuleId],
      );
      const next = await client.query(
        `SELECT COALESCE(MAX(version_number), 0) + 1 AS n
           FROM finance_tax_rule_versions
          WHERE tenant_id = $1 AND tax_rule_id = $2`,
        [input.tenantId, input.taxRuleId],
      );
      const res = await client.query(
        `INSERT INTO finance_tax_rule_versions
           (tenant_id, tax_rule_id, version_number, rate, basis, rounding_mode,
            requires_pkp, account_id, effective_from, effective_to, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [
          input.tenantId,
          input.taxRuleId,
          Number(next.rows[0].n),
          fromRateMicros(rateMicros),
          input.basis,
          input.roundingMode,
          input.requiresPkp,
          input.accountId,
          input.effectiveFrom,
          input.effectiveTo,
          input.createdBy,
        ],
      );
      return toVersion(res.rows[0]);
    });
  }

  async findVersionById(tenantId: string, id: string): Promise<TaxRuleVersion | null> {
    const res = await this.pool.query(
      `SELECT * FROM finance_tax_rule_versions WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return res.rows[0] ? toVersion(res.rows[0]) : null;
  }

  async listVersions(tenantId: string, taxRuleId: string): Promise<TaxRuleVersion[]> {
    const res = await this.pool.query(
      `SELECT * FROM finance_tax_rule_versions
        WHERE tenant_id = $1 AND tax_rule_id = $2
        ORDER BY version_number`,
      [tenantId, taxRuleId],
    );
    return res.rows.map(toVersion);
  }

  /** Approved versions for one Legal Entity — the candidate set for a
   *  calculation on a given date. Drafts never leave the repository. */
  async listApprovedVersionsForEntity(
    tenantId: string,
    legalEntityId: string,
  ): Promise<TaxRuleVersion[]> {
    const res = await this.pool.query(
      `SELECT v.* FROM finance_tax_rule_versions v
         JOIN finance_tax_rules r ON r.id = v.tax_rule_id AND r.tenant_id = v.tenant_id
        WHERE v.tenant_id = $1 AND r.legal_entity_id = $2 AND v.status = 'approved'
        ORDER BY v.version_number`,
      [tenantId, legalEntityId],
    );
    return res.rows.map(toVersion);
  }

  async setVersionWorkflowInstance(
    tenantId: string,
    versionId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE finance_tax_rule_versions SET workflow_instance_id = $3
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, versionId, workflowInstanceId],
    );
  }

  /** Approve a draft version and supersede the one it replaces. Immutability is
   *  structural: nothing here writes a column other than the lifecycle ones. */
  async approveVersion(
    tenantId: string,
    versionId: string,
    approvedBy: string,
  ): Promise<TaxRuleVersion | null> {
    return this.inTransaction(async (client) => {
      const found = await client.query(
        `SELECT * FROM finance_tax_rule_versions WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, versionId],
      );
      if (!found.rows[0]) return null;
      const version = toVersion(found.rows[0]);
      if (version.status !== "draft") {
        throw new TaxError("Only a draft rule version can be approved");
      }
      // The version this one replaces — same rule, currently approved — is
      // superseded from the new version's start date, never edited.
      await client.query(
        `UPDATE finance_tax_rule_versions
            SET status = 'superseded', effective_to = $3
          WHERE tenant_id = $1 AND tax_rule_id = $2
            AND status = 'approved' AND effective_to IS NULL
            AND effective_from < $3`,
        [tenantId, version.taxRuleId, version.effectiveFrom],
      );
      const res = await client.query(
        `UPDATE finance_tax_rule_versions
            SET status = 'approved', approved_by = $3, approved_at = now()
          WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, versionId, approvedBy],
      );
      return toVersion(res.rows[0]);
    });
  }

  // ------------------------------------------------------------------
  // Calculations
  // ------------------------------------------------------------------

  async findCalculationByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<TaxCalculation | null> {
    const res = await this.pool.query(
      `SELECT * FROM finance_tax_calculations WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, idempotencyKey],
    );
    return res.rows[0] ? toCalculation(res.rows[0]) : null;
  }

  async createCalculation(input: {
    tenantId: string;
    legalEntityId: string;
    ruleVersionId: string;
    taxpayerStatus: TaxpayerStatus;
    basisAmount: string;
    rate: string;
    roundingMode: RoundingMode;
    taxAmount: string;
    currency: string;
    calculationDate: string;
    documentRefTable: string | null;
    documentRefId: string | null;
    idempotencyKey: string;
    createdBy: string | null;
  }): Promise<TaxCalculation> {
    const basis = toCents(input.basisAmount);
    const tax = toCents(input.taxAmount);
    if (basis === null || tax === null) {
      throw new TaxError("basisAmount and taxAmount must be 2-decimal money values");
    }
    try {
      const res = await this.pool.query(
        `INSERT INTO finance_tax_calculations
           (tenant_id, legal_entity_id, rule_version_id, taxpayer_status, basis_amount,
            rate, rounding_mode, tax_amount, currency, calculation_date,
            document_ref_table, document_ref_id, idempotency_key, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [
          input.tenantId,
          input.legalEntityId,
          input.ruleVersionId,
          input.taxpayerStatus,
          fromCents(basis),
          input.rate,
          input.roundingMode,
          fromCents(tax),
          input.currency,
          input.calculationDate,
          input.documentRefTable,
          input.documentRefId,
          input.idempotencyKey,
          input.createdBy,
        ],
      );
      return toCalculation(res.rows[0]);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new TaxError("A calculation with that idempotency key already exists");
      }
      throw err;
    }
  }

  async listCalculations(
    tenantId: string,
    filter: { legalEntityId?: string; ruleVersionId?: string; documentRefId?: string },
  ): Promise<TaxCalculation[]> {
    const clauses = ["tenant_id = $1"];
    const params: unknown[] = [tenantId];
    if (filter.legalEntityId) {
      params.push(filter.legalEntityId);
      clauses.push(`legal_entity_id = $${params.length}`);
    }
    if (filter.ruleVersionId) {
      params.push(filter.ruleVersionId);
      clauses.push(`rule_version_id = $${params.length}`);
    }
    if (filter.documentRefId) {
      params.push(filter.documentRefId);
      clauses.push(`document_ref_id = $${params.length}`);
    }
    const res = await this.pool.query(
      `SELECT * FROM finance_tax_calculations WHERE ${clauses.join(" AND ")}
        ORDER BY calculation_date DESC, created_at DESC`,
      params,
    );
    return res.rows.map(toCalculation);
  }
}
