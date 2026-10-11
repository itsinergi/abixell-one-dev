import type { Pool } from "pg";
import type {
  CreateCostCenterInput,
  CreatePaymentTermInput,
  FinanceCostCenter,
  FinanceMasterRepository,
  FinancePaymentTerm,
  UpdateCostCenterInput,
  UpdatePaymentTermInput,
} from "../domain/finance-master.entity.js";

/** PostgreSQL `date` columns arrive as JS Date objects at midnight UTC.
 * `toISOString().slice(0, 10)` would shift a day in negative-offset
 * sessions, so format from the local date components instead. */
function toDateString(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

function toCostCenter(row: Record<string, unknown>): FinanceCostCenter {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    code: row.code as string,
    name: row.name as string,
    type: row.type as FinanceCostCenter["type"],
    parentId: (row.parent_id as string | null) ?? null,
    legalEntityId: (row.legal_entity_id as string | null) ?? null,
    orgUnitId: (row.org_unit_id as string | null) ?? null,
    status: row.status as FinanceCostCenter["status"],
    effectiveFrom: toDateString(row.effective_from),
    effectiveTo: row.effective_to ? toDateString(row.effective_to) : null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function toPaymentTerm(row: Record<string, unknown>): FinancePaymentTerm {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    code: row.code as string,
    name: row.name as string,
    netDays: row.net_days as number,
    discountDays: (row.discount_days as number | null) ?? null,
    discountPercent: (row.discount_percent as string | null) ?? null,
    effectiveFrom: toDateString(row.effective_from),
    effectiveTo: row.effective_to ? toDateString(row.effective_to) : null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export class PgFinanceMasterRepository implements FinanceMasterRepository {
  constructor(private readonly pool: Pool) {}

  // --- Cost centers ---------------------------------------------------------

  async createCostCenter(input: CreateCostCenterInput): Promise<FinanceCostCenter> {
    const r = await this.pool.query(
      `INSERT INTO finance_cost_centers
         (tenant_id, code, name, type, parent_id, legal_entity_id, org_unit_id,
          effective_from, effective_to, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10, $10)
       RETURNING *`,
      [
        input.tenantId,
        input.code,
        input.name,
        input.type,
        input.parentId,
        input.legalEntityId,
        input.orgUnitId,
        input.effectiveFrom,
        input.effectiveTo,
        input.createdBy,
      ],
    );
    return toCostCenter(r.rows[0]);
  }

  async findCostCenterById(tenantId: string, id: string): Promise<FinanceCostCenter | null> {
    const r = await this.pool.query(
      `SELECT * FROM finance_cost_centers WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return r.rows[0] ? toCostCenter(r.rows[0]) : null;
  }

  async findCostCenterByCode(tenantId: string, code: string): Promise<FinanceCostCenter | null> {
    const r = await this.pool.query(
      `SELECT * FROM finance_cost_centers WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    );
    return r.rows[0] ? toCostCenter(r.rows[0]) : null;
  }

  async listCostCenters(
    tenantId: string,
    filter: { status?: FinanceCostCenter["status"]; type?: FinanceCostCenter["type"] },
  ): Promise<FinanceCostCenter[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filter.type) {
      params.push(filter.type);
      conditions.push(`type = $${params.length}`);
    }
    const r = await this.pool.query(
      `SELECT * FROM finance_cost_centers WHERE ${conditions.join(" AND ")} ORDER BY code`,
      params,
    );
    return r.rows.map(toCostCenter);
  }

  async updateCostCenter(
    id: string,
    input: UpdateCostCenterInput,
    updatedBy: string | null,
  ): Promise<FinanceCostCenter | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.name !== undefined) {
      params.push(input.name);
      sets.push(`name = $${params.length}`);
    }
    if (input.type !== undefined) {
      params.push(input.type);
      sets.push(`type = $${params.length}`);
    }
    if (input.status !== undefined) {
      params.push(input.status);
      sets.push(`status = $${params.length}`);
    }
    if (input.effectiveTo !== undefined) {
      params.push(input.effectiveTo);
      sets.push(`effective_to = $${params.length}::date`);
    }
    if (sets.length === 0) {
      const cur = await this.pool.query(`SELECT * FROM finance_cost_centers WHERE id = $1`, [id]);
      return cur.rows[0] ? toCostCenter(cur.rows[0]) : null;
    }
    params.push(id);
    params.push(updatedBy);
    const r = await this.pool.query(
      `UPDATE finance_cost_centers SET ${sets.join(", ")}, updated_by = $${params.length}, updated_at = now()
       WHERE id = $${params.length - 1} RETURNING *`,
      params,
    );
    return r.rows[0] ? toCostCenter(r.rows[0]) : null;
  }

  // --- Payment terms ----------------------------------------------------------

  async createPaymentTerm(input: CreatePaymentTermInput): Promise<FinancePaymentTerm> {
    const r = await this.pool.query(
      `INSERT INTO finance_payment_terms
         (tenant_id, code, name, net_days, discount_days, discount_percent,
          effective_from, effective_to, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $9)
       RETURNING *`,
      [
        input.tenantId,
        input.code,
        input.name,
        input.netDays,
        input.discountDays,
        input.discountPercent,
        input.effectiveFrom,
        input.effectiveTo,
        input.createdBy,
      ],
    );
    return toPaymentTerm(r.rows[0]);
  }

  async findPaymentTermById(tenantId: string, id: string): Promise<FinancePaymentTerm | null> {
    const r = await this.pool.query(
      `SELECT * FROM finance_payment_terms WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return r.rows[0] ? toPaymentTerm(r.rows[0]) : null;
  }

  async findPaymentTermByCode(tenantId: string, code: string): Promise<FinancePaymentTerm | null> {
    const r = await this.pool.query(
      `SELECT * FROM finance_payment_terms WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    );
    return r.rows[0] ? toPaymentTerm(r.rows[0]) : null;
  }

  async listPaymentTerms(tenantId: string): Promise<FinancePaymentTerm[]> {
    const r = await this.pool.query(
      `SELECT * FROM finance_payment_terms WHERE tenant_id = $1 ORDER BY code`,
      [tenantId],
    );
    return r.rows.map(toPaymentTerm);
  }

  async updatePaymentTerm(
    id: string,
    input: UpdatePaymentTermInput,
    updatedBy: string | null,
  ): Promise<FinancePaymentTerm | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.name !== undefined) {
      params.push(input.name);
      sets.push(`name = $${params.length}`);
    }
    if (input.effectiveTo !== undefined) {
      params.push(input.effectiveTo);
      sets.push(`effective_to = $${params.length}::date`);
    }
    if (sets.length === 0) {
      const cur = await this.pool.query(`SELECT * FROM finance_payment_terms WHERE id = $1`, [id]);
      return cur.rows[0] ? toPaymentTerm(cur.rows[0]) : null;
    }
    params.push(id);
    params.push(updatedBy);
    const r = await this.pool.query(
      `UPDATE finance_payment_terms SET ${sets.join(", ")}, updated_by = $${params.length}, updated_at = now()
       WHERE id = $${params.length - 1} RETURNING *`,
      params,
    );
    return r.rows[0] ? toPaymentTerm(r.rows[0]) : null;
  }
}
