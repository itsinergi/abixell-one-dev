/**
 * Wave A2 — RPT-ADV-001: Governed Self-Service BI Query Engine.
 *
 * Governed BI metadata surface. There is no arbitrary SQL editor, no schema
 * editor, and no DSL: every dataset and field a tenant can query against is
 * defined statically in code in `BI_DATASET_REGISTRY`.
 *
 * SQL queries are constructed exclusively from this developer-authored registry,
 * ensuring complete immunity to SQL injection, mandatory tenant scoping, and
 * safe aggregation.
 */

import type {
  BiAggregation,
  BiFieldType,
  BiFilterOperator,
  BiQueryConfig,
  BiQueryResult,
  BiResultColumn,
  BiScopeProjection,
} from "../domain/bi.entity.js";
import { ValidationError } from "../../../../domain/shared-kernel/errors.js";

export interface RegisteredFieldDef {
  code: string;
  name: string;
  fieldType: BiFieldType;
  /** Safe SQL column expression relative to base query alias (e.g. `c.status` or `c.created_at`). */
  sqlColumn: string;
  isDimension: boolean;
  isMeasure: boolean;
  isFilterable: boolean;
  defaultAggregation?: BiAggregation;
  sortOrder: number;
}

export interface RegisteredDatasetDef {
  code: string;
  name: string;
  description: string;
  moduleCode: string;
  requiredPermissions: string[];
  /** Base table / CTE with alias. Must expose the aliases referenced by fields and scope clauses. */
  baseFrom: string;
  tenantWhere: string;
  deletedWhere?: string;
  scopeKind: "customer" | "survey";
  fields: RegisteredFieldDef[];
}

export const BI_DATASET_REGISTRY: RegisteredDatasetDef[] = [
  {
    code: "complaint_lifecycle",
    name: "Complaint Lifecycle & Operations",
    description: "Operational metrics on customer complaints, statuses, priorities, and channels.",
    moduleCode: "customer_complaint",
    requiredPermissions: ["reporting.read"],
    baseFrom:
      `complaints c
       JOIN customers cust ON cust.id = c.customer_id AND cust.tenant_id = c.tenant_id
       LEFT JOIN workflow_instances wi ON wi.id = c.workflow_instance_id AND wi.tenant_id = c.tenant_id
       LEFT JOIN workflow_steps wst ON wst.id = wi.current_step_id`,
    tenantWhere: "c.tenant_id = $1",
    deletedWhere: "c.deleted_at IS NULL",
    scopeKind: "customer",
    fields: [
      {
        code: "status",
        name: "Status",
        fieldType: "text",
        sqlColumn: "COALESCE(wst.code, wi.status)",
        isDimension: true,
        isMeasure: false,
        isFilterable: true,
        sortOrder: 1,
      },
      {
        code: "priority",
        name: "Priority",
        fieldType: "text",
        sqlColumn: "c.priority",
        isDimension: true,
        isMeasure: false,
        isFilterable: true,
        sortOrder: 2,
      },
      {
        code: "channel",
        name: "Intake Channel",
        fieldType: "text",
        sqlColumn: "c.channel",
        isDimension: true,
        isMeasure: false,
        isFilterable: true,
        sortOrder: 3,
      },
      {
        code: "created_date",
        name: "Creation Date",
        fieldType: "date",
        sqlColumn: "to_char(date_trunc('day', c.created_at), 'YYYY-MM-DD')",
        isDimension: true,
        isMeasure: false,
        isFilterable: true,
        sortOrder: 4,
      },
      {
        code: "total_complaints",
        name: "Total Complaints",
        fieldType: "number",
        sqlColumn: "COUNT(*)",
        isDimension: false,
        isMeasure: true,
        isFilterable: false,
        defaultAggregation: "count",
        sortOrder: 10,
      },
    ],
  },
  {
    code: "sla_performance",
    name: "SLA Targets & Breach Performance",
    description: "Service quality metrics on response & resolution SLA compliance.",
    moduleCode: "customer_complaint",
    requiredPermissions: ["reporting.read"],
    baseFrom:
      "complaint_sla_targets st JOIN complaints c ON st.complaint_id = c.id AND st.tenant_id = c.tenant_id JOIN customers cust ON cust.id = c.customer_id AND cust.tenant_id = c.tenant_id",
    tenantWhere: "st.tenant_id = $1",
    deletedWhere: "c.deleted_at IS NULL",
    scopeKind: "customer",
    fields: [
      {
        code: "response_breached",
        name: "Response Breached",
        fieldType: "boolean",
        sqlColumn: "st.response_breached",
        isDimension: true,
        isMeasure: false,
        isFilterable: true,
        sortOrder: 1,
      },
      {
        code: "resolution_breached",
        name: "Resolution Breached",
        fieldType: "boolean",
        sqlColumn: "st.resolution_breached",
        isDimension: true,
        isMeasure: false,
        isFilterable: true,
        sortOrder: 2,
      },
      {
        code: "priority",
        name: "Complaint Priority",
        fieldType: "text",
        sqlColumn: "c.priority",
        isDimension: true,
        isMeasure: false,
        isFilterable: true,
        sortOrder: 3,
      },
      {
        code: "total_targets",
        name: "Total SLA Targets",
        fieldType: "number",
        sqlColumn: "COUNT(*)",
        isDimension: false,
        isMeasure: true,
        isFilterable: false,
        defaultAggregation: "count",
        sortOrder: 10,
      },
      {
        code: "breached_count",
        name: "Total Breaches",
        fieldType: "number",
        sqlColumn: "COUNT(*) FILTER (WHERE st.response_breached = true OR st.resolution_breached = true)",
        isDimension: false,
        isMeasure: true,
        isFilterable: false,
        defaultAggregation: "count",
        sortOrder: 11,
      },
    ],
  },
  {
    code: "survey_analytics",
    name: "Survey & CSAT Feedback",
    description: "Customer satisfaction scores, NPS ratings, and response volumes.",
    moduleCode: "survey_assessment",
    requiredPermissions: ["reporting.read"],
    baseFrom:
      `survey_assignments sa
       JOIN survey_versions sv ON sa.survey_version_id = sv.id
       JOIN survey_definitions sd ON sv.survey_definition_id = sd.id AND sa.tenant_id = sd.tenant_id
       LEFT JOIN customers direct_customer
         ON sa.context_entity_type = 'customer'
        AND direct_customer.id = sa.context_entity_id
        AND direct_customer.tenant_id = sa.tenant_id
       LEFT JOIN complaints scoped_complaint
         ON sa.context_entity_type = 'complaint'
        AND scoped_complaint.id = sa.context_entity_id
        AND scoped_complaint.tenant_id = sa.tenant_id
       LEFT JOIN customers complaint_customer
         ON complaint_customer.id = scoped_complaint.customer_id
        AND complaint_customer.tenant_id = sa.tenant_id
       LEFT JOIN projects scoped_project
         ON sa.context_entity_type = 'project'
        AND scoped_project.id = sa.context_entity_id
        AND scoped_project.tenant_id = sa.tenant_id
       LEFT JOIN customers project_customer
         ON project_customer.id = scoped_project.customer_id
        AND project_customer.tenant_id = sa.tenant_id
       LEFT JOIN sites scoped_site
         ON sa.context_entity_type = 'site'
        AND scoped_site.id = sa.context_entity_id
        AND scoped_site.tenant_id = sa.tenant_id
       LEFT JOIN customers site_customer
         ON site_customer.id = scoped_site.customer_id
        AND site_customer.tenant_id = sa.tenant_id`,
    tenantWhere: "sa.tenant_id = $1",
    scopeKind: "survey",
    fields: [
      {
        code: "survey_code",
        name: "Survey Code",
        fieldType: "text",
        sqlColumn: "sd.code",
        isDimension: true,
        isMeasure: false,
        isFilterable: true,
        sortOrder: 1,
      },
      {
        code: "respondent_type",
        name: "Respondent Type",
        fieldType: "text",
        sqlColumn: "sa.respondent_type",
        isDimension: true,
        isMeasure: false,
        isFilterable: true,
        sortOrder: 2,
      },
      {
        code: "status",
        name: "Submission Status",
        fieldType: "text",
        sqlColumn: "sa.status",
        isDimension: true,
        isMeasure: false,
        isFilterable: true,
        sortOrder: 3,
      },
      {
        code: "total_assignments",
        name: "Total Assignments",
        fieldType: "number",
        sqlColumn: "COUNT(*)",
        isDimension: false,
        isMeasure: true,
        isFilterable: false,
        defaultAggregation: "count",
        sortOrder: 10,
      },
      {
        code: "avg_score",
        name: "Average Score",
        fieldType: "number",
        sqlColumn: "ROUND(AVG(sa.total_score)::numeric, 2)",
        isDimension: false,
        isMeasure: true,
        isFilterable: false,
        defaultAggregation: "avg",
        sortOrder: 11,
      },
      {
        code: "avg_nps",
        name: "Average NPS",
        fieldType: "number",
        sqlColumn: "ROUND(AVG(sa.nps_score)::numeric, 2)",
        isDimension: false,
        isMeasure: true,
        isFilterable: false,
        defaultAggregation: "avg",
        sortOrder: 12,
      },
    ],
  },
];

const ALLOWED_OPERATORS: BiFilterOperator[] = ["eq", "neq", "gt", "gte", "lt", "lte", "in"];

export function getRegisteredDataset(code: string): RegisteredDatasetDef {
  const dataset = BI_DATASET_REGISTRY.find((d) => d.code === code);
  if (!dataset) {
    throw new ValidationError(`Dataset '${code}' is not registered`);
  }
  return dataset;
}

export class BiQueryEngine {
  /**
   * Compiles a query configuration into parameterized SQL statement.
   * Parameter $1 is ALWAYS the tenantId.
   */
  compileQuery(
    tenantId: string,
    config: BiQueryConfig,
    scope: BiScopeProjection,
  ): { sql: string; params: unknown[]; columns: BiResultColumn[] } {
    const dataset = getRegisteredDataset(config.datasetCode);

    if (config.dimensions.length === 0 && config.measures.length === 0) {
      throw new ValidationError("BI Query must request at least one dimension or measure");
    }

    const fieldMap = new Map<string, RegisteredFieldDef>();
    for (const f of dataset.fields) {
      fieldMap.set(f.code, f);
    }

    const selectExprs: string[] = [];
    const groupExprs: string[] = [];
    const columns: BiResultColumn[] = [];

    // Process dimensions
    for (const dimCode of config.dimensions) {
      const field = fieldMap.get(dimCode);
      if (!field || !field.isDimension) {
        throw new ValidationError(`Field '${dimCode}' is not a valid dimension in dataset '${dataset.code}'`);
      }
      selectExprs.push(`${field.sqlColumn} AS "${field.code}"`);
      groupExprs.push(field.sqlColumn);
      columns.push({
        key: field.code,
        label: field.name,
        type: field.fieldType,
      });
    }

    // Process measures
    for (const measureCode of config.measures) {
      const field = fieldMap.get(measureCode);
      if (!field || !field.isMeasure) {
        throw new ValidationError(`Field '${measureCode}' is not a valid measure in dataset '${dataset.code}'`);
      }
      selectExprs.push(`${field.sqlColumn} AS "${field.code}"`);
      columns.push({
        key: field.code,
        label: field.name,
        type: field.fieldType,
      });
    }

    // Build WHERE clause
    const whereClauses: string[] = [];
    const params: unknown[] = [tenantId];

    whereClauses.push(dataset.tenantWhere);
    if (dataset.deletedWhere) whereClauses.push(dataset.deletedWhere);
    const scopeWhere = this.scopeWhereSql(dataset, scope, params);
    if (scopeWhere) whereClauses.push(scopeWhere);

    // Process user-supplied filters
    for (const filter of config.filters ?? []) {
      const field = fieldMap.get(filter.field);
      if (!field || !field.isFilterable) {
        throw new ValidationError(`Field '${filter.field}' is not filterable in dataset '${dataset.code}'`);
      }
      if (!ALLOWED_OPERATORS.includes(filter.operator)) {
        throw new ValidationError(`Unsupported filter operator '${filter.operator}'`);
      }

      const paramIdx = params.length + 1;

      if (filter.operator === "eq") {
        params.push(filter.value);
        whereClauses.push(`${field.sqlColumn} = $${paramIdx}`);
      } else if (filter.operator === "neq") {
        params.push(filter.value);
        whereClauses.push(`${field.sqlColumn} != $${paramIdx}`);
      } else if (filter.operator === "gt") {
        params.push(filter.value);
        whereClauses.push(`${field.sqlColumn} > $${paramIdx}`);
      } else if (filter.operator === "gte") {
        params.push(filter.value);
        whereClauses.push(`${field.sqlColumn} >= $${paramIdx}`);
      } else if (filter.operator === "lt") {
        params.push(filter.value);
        whereClauses.push(`${field.sqlColumn} < $${paramIdx}`);
      } else if (filter.operator === "lte") {
        params.push(filter.value);
        whereClauses.push(`${field.sqlColumn} <= $${paramIdx}`);
      } else if (filter.operator === "in") {
        if (!Array.isArray(filter.value) || filter.value.length === 0) {
          throw new ValidationError(`Filter operator 'in' for field '${filter.field}' requires a non-empty array`);
        }
        params.push(filter.value);
        whereClauses.push(`${field.sqlColumn} = ANY($${paramIdx})`);
      }
    }

    let sql = `SELECT ${selectExprs.join(", ")} FROM ${dataset.baseFrom}`;
    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(" AND ")}`;
    }
    if (groupExprs.length > 0) {
      sql += ` GROUP BY ${groupExprs.join(", ")}`;
      sql += ` ORDER BY ${groupExprs.join(", ")} ASC`;
    }
    sql += ` LIMIT 1000`;

    return { sql, params, columns };
  }

  private scopeWhereSql(
    dataset: RegisteredDatasetDef,
    scope: BiScopeProjection,
    params: unknown[],
  ): string {
    if (scope.tenantWide) return "";

    if (dataset.scopeKind === "customer") {
      params.push(scope.customerIds);
      const custIdx = params.length;
      params.push(scope.orgUnitIds);
      const orgIdx = params.length;
      return `(c.customer_id = ANY($${custIdx}::uuid[]) OR cust.owner_organization_unit_id = ANY($${orgIdx}::uuid[]))`;
    }

    // dataset.scopeKind === "survey"
    params.push(scope.customerIds);
    const custIdx = params.length;
    params.push(scope.orgUnitIds);
    const orgIdx = params.length;

    return `(
      direct_customer.id = ANY($${custIdx}::uuid[])
      OR direct_customer.owner_organization_unit_id = ANY($${orgIdx}::uuid[])
      OR complaint_customer.id = ANY($${custIdx}::uuid[])
      OR complaint_customer.owner_organization_unit_id = ANY($${orgIdx}::uuid[])
      OR project_customer.id = ANY($${custIdx}::uuid[])
      OR project_customer.owner_organization_unit_id = ANY($${orgIdx}::uuid[])
      OR site_customer.id = ANY($${custIdx}::uuid[])
      OR site_customer.owner_organization_unit_id = ANY($${orgIdx}::uuid[])
    )`;
  }

  /**
   * Formats raw SQL row records into clean, typed BiQueryResult.
   */
  formatResult(
    datasetCode: string,
    columns: BiResultColumn[],
    rows: Record<string, unknown>[],
  ): BiQueryResult {
    const formattedRows = rows.map((r) => {
      const rowObj: Record<string, string | number | boolean | null> = {};
      for (const col of columns) {
        const rawVal = r[col.key];
        if (rawVal === null || rawVal === undefined) {
          rowObj[col.key] = null;
        } else if (col.type === "number" || col.type === "money") {
          rowObj[col.key] = Number(rawVal);
        } else if (col.type === "boolean") {
          rowObj[col.key] = Boolean(rawVal);
        } else {
          rowObj[col.key] = String(rawVal);
        }
      }
      return rowObj;
    });

    return {
      datasetCode,
      columns,
      rows: formattedRows,
      rowCount: formattedRows.length,
      truncated: formattedRows.length >= 1000,
      generatedAt: new Date(),
    };
  }
}
