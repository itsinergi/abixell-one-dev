import type { Pool } from "pg";
import type {
  BiAggregation,
  BiDataset,
  BiDatasetField,
  BiFieldType,
  BiQueryConfig,
  BiRepository,
  BiSavedReport,
  BiScopeProjection,
} from "../domain/bi.entity.js";

function toDataset(r: Record<string, unknown>): BiDataset {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    code: r.code as string,
    name: r.name as string,
    description: (r.description as string) ?? null,
    moduleCode: r.module_code as string,
    requiredPermissions: (r.required_permissions as string[]) ?? [],
    isActive: r.is_active as boolean,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

function toField(r: Record<string, unknown>): BiDatasetField {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    datasetId: r.dataset_id as string,
    code: r.code as string,
    name: r.name as string,
    fieldType: r.field_type as BiFieldType,
    isDimension: r.is_dimension as boolean,
    isMeasure: r.is_measure as boolean,
    isFilterable: r.is_filterable as boolean,
    aggregation: (r.aggregation as BiAggregation) ?? null,
    sortOrder: r.sort_order as number,
  };
}

function toSavedReport(r: Record<string, unknown>): BiSavedReport {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    datasetId: r.dataset_id as string,
    code: r.code as string,
    title: r.title as string,
    description: (r.description as string) ?? null,
    config: (r.config as BiQueryConfig) ?? { datasetCode: "", dimensions: [], measures: [], filters: [] },
    isShared: r.is_shared as boolean,
    createdBy: (r.created_by as string) ?? null,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

/**
 * PostgreSQL persistence for the governed BI metadata surface. This
 * repository never assembles ad hoc SQL from field/dataset row content —
 * `runGovernedQuery` only executes SQL text handed to it by
 * `BiQueryEngine`, which builds it exclusively from the static, code-owned
 * dataset registry (see `application/bi-query.engine.ts`).
 */
export class PgBiRepository implements BiRepository {
  constructor(private readonly pool: Pool) {}

  async ensureDatasetProvisioned(input: {
    tenantId: string;
    code: string;
    name: string;
    description: string | null;
    moduleCode: string;
    requiredPermissions: string[];
  }): Promise<BiDataset> {
    const r = await this.pool.query(
      `INSERT INTO bi_datasets (tenant_id, code, name, description, module_code, base_query, required_permissions)
       VALUES ($1,$2,$3,$4,$5,'', $6)
       ON CONFLICT (tenant_id, code)
       DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
                      required_permissions = EXCLUDED.required_permissions, updated_at = now()
       RETURNING *`,
      [input.tenantId, input.code, input.name, input.description, input.moduleCode, input.requiredPermissions],
    );
    return toDataset(r.rows[0]);
  }

  async ensureFieldProvisioned(input: {
    tenantId: string;
    datasetId: string;
    code: string;
    name: string;
    fieldType: BiFieldType;
    isDimension: boolean;
    isMeasure: boolean;
    isFilterable: boolean;
    aggregation: BiAggregation | null;
    sortOrder: number;
  }): Promise<BiDatasetField> {
    const r = await this.pool.query(
      `INSERT INTO bi_dataset_fields
         (tenant_id, dataset_id, code, name, field_type, sql_expression,
          is_dimension, is_measure, is_filterable, aggregation, sort_order)
       VALUES ($1,$2,$3,$4,$5,'', $6,$7,$8,$9,$10)
       ON CONFLICT (dataset_id, code)
       DO UPDATE SET name = EXCLUDED.name, field_type = EXCLUDED.field_type,
                      is_dimension = EXCLUDED.is_dimension, is_measure = EXCLUDED.is_measure,
                      is_filterable = EXCLUDED.is_filterable, aggregation = EXCLUDED.aggregation,
                      sort_order = EXCLUDED.sort_order
       RETURNING *`,
      [
        input.tenantId,
        input.datasetId,
        input.code,
        input.name,
        input.fieldType,
        input.isDimension,
        input.isMeasure,
        input.isFilterable,
        input.aggregation,
        input.sortOrder,
      ],
    );
    return toField(r.rows[0]);
  }

  async listDatasets(tenantId: string): Promise<BiDataset[]> {
    const r = await this.pool.query(
      `SELECT * FROM bi_datasets WHERE tenant_id = $1 AND is_active ORDER BY code`,
      [tenantId],
    );
    return r.rows.map(toDataset);
  }

  async findDatasetByCode(tenantId: string, code: string): Promise<BiDataset | null> {
    const r = await this.pool.query(
      `SELECT * FROM bi_datasets WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    );
    return r.rows[0] ? toDataset(r.rows[0]) : null;
  }

  async listDatasetFields(tenantId: string, datasetId: string): Promise<BiDatasetField[]> {
    const r = await this.pool.query(
      `SELECT * FROM bi_dataset_fields WHERE tenant_id = $1 AND dataset_id = $2 ORDER BY sort_order, code`,
      [tenantId, datasetId],
    );
    return r.rows.map(toField);
  }

  async listActiveModuleCodes(tenantId: string): Promise<string[]> {
    const r = await this.pool.query(
      `SELECT m.code
         FROM modules m
         JOIN tenant_module_activations tma
           ON tma.module_id = m.id
          AND tma.tenant_id = $1
          AND tma.is_active = true`,
      [tenantId],
    );
    return r.rows.map((row) => row.code as string);
  }

  async createSavedReport(input: {
    tenantId: string;
    datasetId: string;
    code: string;
    title: string;
    description: string | null;
    config: BiQueryConfig;
    isShared: boolean;
    createdBy: string | null;
  }): Promise<BiSavedReport> {
    const r = await this.pool.query(
      `INSERT INTO bi_saved_reports (tenant_id, dataset_id, code, title, description, config, is_shared, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        input.tenantId,
        input.datasetId,
        input.code,
        input.title,
        input.description,
        JSON.stringify(input.config),
        input.isShared,
        input.createdBy,
      ],
    );
    return toSavedReport(r.rows[0]);
  }

  async listSavedReports(tenantId: string, datasetId?: string): Promise<BiSavedReport[]> {
    if (datasetId) {
      const r = await this.pool.query(
        `SELECT * FROM bi_saved_reports WHERE tenant_id = $1 AND dataset_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC`,
        [tenantId, datasetId],
      );
      return r.rows.map(toSavedReport);
    }
    const r = await this.pool.query(
      `SELECT * FROM bi_saved_reports WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [tenantId],
    );
    return r.rows.map(toSavedReport);
  }

  async findSavedReportById(tenantId: string, id: string): Promise<BiSavedReport | null> {
    const r = await this.pool.query(
      `SELECT * FROM bi_saved_reports WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    return r.rows[0] ? toSavedReport(r.rows[0]) : null;
  }

  async deleteSavedReport(tenantId: string, id: string): Promise<boolean> {
    // Soft delete only — saved report configuration is retained as historical
    // evidence of what was executed, consistent with the no-hard-delete rule.
    const r = await this.pool.query(
      `UPDATE bi_saved_reports SET deleted_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL RETURNING id`,
      [tenantId, id],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async getScopeProjection(
    tenantId: string,
    userId: string,
    requiredPermissionCodes: readonly string[],
  ): Promise<BiScopeProjection> {
    const requiredCodes = [...new Set(requiredPermissionCodes)];
    if (requiredCodes.length === 0) {
      return { tenantWide: false, customerIds: [], orgUnitIds: [] };
    }

    const r = await this.pool.query(
      `WITH RECURSIVE reporting_assignments AS (
          SELECT aura.id,
                 aura.scope_type,
                 aura.scope_organization_unit_id,
                 aura.scope_customer_id
            FROM authorization_effective_user_role_assignments aura
            JOIN role_permissions rp ON rp.role_id = aura.role_id
            JOIN permissions p ON p.id = rp.permission_id
           WHERE aura.user_id = $2
             AND aura.tenant_id = $1
             AND p.code = ANY($3::text[])
           GROUP BY aura.id,
                    aura.scope_type,
                    aura.scope_organization_unit_id,
                    aura.scope_customer_id
          HAVING COUNT(DISTINCT p.code) = $4
        ),
        assigned_orgs(id) AS (
          SELECT ra.scope_organization_unit_id
            FROM reporting_assignments ra
           WHERE ra.scope_type = 'organization_unit'
             AND ra.scope_organization_unit_id IS NOT NULL
          UNION
          SELECT ou.id
            FROM organization_units ou
            JOIN assigned_orgs ao ON ou.parent_id = ao.id
           WHERE ou.tenant_id = $1
             AND ou.deleted_at IS NULL
        )
        SELECT
          EXISTS (
            SELECT 1
              FROM reporting_assignments ra
             WHERE ra.scope_type = 'tenant'
          ) AS tenant_wide,
          COALESCE(ARRAY(
            SELECT DISTINCT ra.scope_customer_id
              FROM reporting_assignments ra
             WHERE ra.scope_type = 'customer'
               AND ra.scope_customer_id IS NOT NULL
          ), '{}'::uuid[]) AS customer_ids,
          COALESCE(ARRAY(
            SELECT DISTINCT id
              FROM assigned_orgs
             WHERE id IS NOT NULL
          ), '{}'::uuid[]) AS org_unit_ids`,
      [tenantId, userId, requiredCodes, requiredCodes.length],
    );
    const row = r.rows[0];
    return {
      tenantWide: row.tenant_wide as boolean,
      customerIds: (row.customer_ids as string[]) ?? [],
      orgUnitIds: (row.org_unit_ids as string[]) ?? [],
    };
  }

  async runGovernedQuery(
    sql: string,
    params: unknown[],
    timeoutMs = 5_000,
  ): Promise<Record<string, unknown>[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query(`SET LOCAL statement_timeout = '${Math.max(1, Math.min(timeoutMs, 10_000))}ms'`);
      const r = await client.query(sql, params);
      await client.query("COMMIT");
      return r.rows;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
