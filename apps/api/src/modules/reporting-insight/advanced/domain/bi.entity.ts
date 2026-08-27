/**
 * Wave A2 — RPT-ADV-001: Self-Service BI and Reporting Warehouse.
 *
 * Governed BI metadata surface. There is no arbitrary SQL editor, no schema
 * editor, and no DSL: every dataset and field a tenant can query against is
 * defined once, in code, by `BI_DATASET_REGISTRY` (see
 * `application/bi-query.engine.ts`). The `bi_datasets`/`bi_dataset_fields`
 * tables mirror that registry per-tenant purely so the UI can list what is
 * queryable — the query engine never reads SQL text out of those rows; it
 * always resolves dimension/measure codes back to the static, developer
 * authored registry before building a query.
 */

export type BiFieldType = "text" | "number" | "money" | "date" | "boolean";
export type BiAggregation = "sum" | "avg" | "count" | "min" | "max";
export type BiFilterOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in";

export interface BiDataset {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  moduleCode: string;
  requiredPermissions: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface BiDatasetField {
  id: string;
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
}

export interface BiFilter {
  field: string;
  operator: BiFilterOperator;
  value: string | number | boolean | Array<string | number>;
}

export interface BiQueryConfig {
  datasetCode: string;
  dimensions: string[];
  measures: string[];
  filters: BiFilter[];
}

export interface BiResultColumn {
  key: string;
  label: string;
  type: BiFieldType;
}

export interface BiScopeProjection {
  tenantWide: boolean;
  customerIds: string[];
  orgUnitIds: string[];
}

export interface BiQueryResult {
  datasetCode: string;
  columns: BiResultColumn[];
  rows: Array<Record<string, string | number | boolean | null>>;
  rowCount: number;
  truncated: boolean;
  generatedAt: Date;
}

export interface BiSavedReport {
  id: string;
  tenantId: string;
  datasetId: string;
  code: string;
  title: string;
  description: string | null;
  config: BiQueryConfig;
  isShared: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BiRepository {
  ensureDatasetProvisioned(input: {
    tenantId: string;
    code: string;
    name: string;
    description: string | null;
    moduleCode: string;
    requiredPermissions: string[];
  }): Promise<BiDataset>;
  ensureFieldProvisioned(input: {
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
  }): Promise<BiDatasetField>;
  listDatasets(tenantId: string): Promise<BiDataset[]>;
  findDatasetByCode(tenantId: string, code: string): Promise<BiDataset | null>;
  listDatasetFields(tenantId: string, datasetId: string): Promise<BiDatasetField[]>;
  listActiveModuleCodes(tenantId: string): Promise<string[]>;

  createSavedReport(input: {
    tenantId: string;
    datasetId: string;
    code: string;
    title: string;
    description: string | null;
    config: BiQueryConfig;
    isShared: boolean;
    createdBy: string | null;
  }): Promise<BiSavedReport>;
  listSavedReports(tenantId: string, datasetId?: string): Promise<BiSavedReport[]>;
  findSavedReportById(tenantId: string, id: string): Promise<BiSavedReport | null>;
  deleteSavedReport(tenantId: string, id: string): Promise<boolean>;

  getScopeProjection(
    tenantId: string,
    userId: string,
    requiredPermissionCodes: readonly string[],
  ): Promise<BiScopeProjection>;

  /**
   * Runs a fully-built, parameterized SELECT statement with bounded execution timeout.
   * The SQL text passed in must originate solely from `BiQueryEngine`, which
   * composes it from the static `BI_DATASET_REGISTRY` — never from HTTP-supplied strings.
   */
  runGovernedQuery(sql: string, params: unknown[], timeoutMs?: number): Promise<Record<string, unknown>[]>;
}
