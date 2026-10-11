import type { Pool } from "pg";
import type {
  CreateConversionInput,
  CreateUomInput,
  UnitConversion,
  UnitOfMeasure,
  UomCategory,
  UomRepository,
} from "../domain/uom.entity.js";

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

function toUnit(row: Record<string, unknown>): UnitOfMeasure {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    code: row.code as string,
    name: row.name as string,
    baseUnitCode: row.base_unit_code as string,
    category: row.category as UomCategory,
    isActive: row.is_active as boolean,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function toConversion(row: Record<string, unknown>): UnitConversion {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    fromUnitId: row.from_unit_id as string,
    toUnitId: row.to_unit_id as string,
    factor: row.factor as string,
    effectiveFrom: toDateString(row.effective_from),
    effectiveTo: row.effective_to ? toDateString(row.effective_to) : null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export class PgUomRepository implements UomRepository {
  constructor(private readonly pool: Pool) {}

  // --- Units ------------------------------------------------------------

  async createUnit(input: CreateUomInput): Promise<UnitOfMeasure> {
    const r = await this.pool.query(
      `INSERT INTO units_of_measure (tenant_id, code, name, base_unit_code, category, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING *`,
      [input.tenantId, input.code, input.name, input.baseUnitCode, input.category, input.createdBy],
    );
    return toUnit(r.rows[0]);
  }

  async findUnitById(tenantId: string, id: string): Promise<UnitOfMeasure | null> {
    const r = await this.pool.query(`SELECT * FROM units_of_measure WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      id,
    ]);
    return r.rows[0] ? toUnit(r.rows[0]) : null;
  }

  async findUnitByCode(tenantId: string, code: string): Promise<UnitOfMeasure | null> {
    const r = await this.pool.query(`SELECT * FROM units_of_measure WHERE tenant_id = $1 AND code = $2`, [
      tenantId,
      code,
    ]);
    return r.rows[0] ? toUnit(r.rows[0]) : null;
  }

  async listUnits(
    tenantId: string,
    filter: { category?: UomCategory; activeOnly?: boolean },
  ): Promise<UnitOfMeasure[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];
    if (filter.category) {
      params.push(filter.category);
      conditions.push(`category = $${params.length}`);
    }
    if (filter.activeOnly) conditions.push(`is_active = true`);
    const r = await this.pool.query(
      `SELECT * FROM units_of_measure WHERE ${conditions.join(" AND ")} ORDER BY code`,
      params,
    );
    return r.rows.map(toUnit);
  }

  async updateUnit(id: string, input: { isActive: boolean }, updatedBy: string | null): Promise<UnitOfMeasure | null> {
    const r = await this.pool.query(
      `UPDATE units_of_measure SET is_active = $2, updated_by = $3, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [id, input.isActive, updatedBy],
    );
    return r.rows[0] ? toUnit(r.rows[0]) : null;
  }

  // --- Conversions --------------------------------------------------------

  async createConversion(input: CreateConversionInput): Promise<UnitConversion> {
    const r = await this.pool.query(
      `INSERT INTO unit_conversions
         (tenant_id, from_unit_id, to_unit_id, factor, effective_from, effective_to, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $7) RETURNING *`,
      [
        input.tenantId,
        input.fromUnitId,
        input.toUnitId,
        input.factor,
        input.effectiveFrom,
        input.effectiveTo,
        input.createdBy,
      ],
    );
    return toConversion(r.rows[0]);
  }

  /** Effective-dated lookup: only conversions whose window covers `onDate`
   * are considered, latest-created wins if multiple cover the date. */
  async findConversion(
    tenantId: string,
    fromUnitId: string,
    toUnitId: string,
    onDate: string,
  ): Promise<UnitConversion | null> {
    const r = await this.pool.query(
      `SELECT * FROM unit_conversions
        WHERE tenant_id = $1 AND from_unit_id = $2 AND to_unit_id = $3
          AND effective_from <= $4::date
          AND (effective_to IS NULL OR effective_to >= $4::date)
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId, fromUnitId, toUnitId, onDate],
    );
    return r.rows[0] ? toConversion(r.rows[0]) : null;
  }

  async findConversionExact(tenantId: string, fromUnitId: string, toUnitId: string): Promise<UnitConversion | null> {
    const r = await this.pool.query(
      `SELECT * FROM unit_conversions WHERE tenant_id = $1 AND from_unit_id = $2 AND to_unit_id = $3`,
      [tenantId, fromUnitId, toUnitId],
    );
    return r.rows[0] ? toConversion(r.rows[0]) : null;
  }

  async listConversions(tenantId: string, fromUnitId?: string): Promise<UnitConversion[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];
    if (fromUnitId) {
      params.push(fromUnitId);
      conditions.push(`from_unit_id = $${params.length}`);
    }
    const r = await this.pool.query(
      `SELECT * FROM unit_conversions WHERE ${conditions.join(" AND ")} ORDER BY created_at`,
      params,
    );
    return r.rows.map(toConversion);
  }

  /** 1 / factor in exact decimal. */
  async inverseFactor(factor: string): Promise<string> {
    const r = await this.pool.query(`SELECT (1.0 / $1::numeric)::text AS v`, [factor]);
    return r.rows[0].v as string;
  }

  /** quantity * factor in exact decimal. */
  async multiplyNumeric(quantity: string, factor: string): Promise<string> {
    const r = await this.pool.query(
      `SELECT (($1::numeric * $2::numeric)::numeric(24,6))::text AS v`,
      [quantity, factor],
    );
    return r.rows[0].v as string;
  }
}
