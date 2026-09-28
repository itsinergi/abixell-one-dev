
/**
 * Wave A2 — RPT-ADV-001: Self-Service BI Application Service.
 *
 * Provides governed BI dataset querying, report CRUD, and CSV export. Every
 * executable query is permission-set gated, module-activation gated, tenant
 * isolated, and projected through the actor's Customer Data Scope.
 */

import type {
  BiDataset,
  BiDatasetField,
  BiQueryConfig,
  BiQueryResult,
  BiRepository,
  BiSavedReport,
} from "../domain/bi.entity.js";
import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import { ConflictError, NotFoundError } from "../../../../domain/shared-kernel/errors.js";
import type { AuditService } from "../../../../application/audit/audit.service.js";
import type { RbacService } from "../../../../application/rbac/rbac.service.js";
import {
  BI_DATASET_REGISTRY,
  BiQueryEngine,
  getRegisteredDataset,
  type RegisteredDatasetDef,
} from "./bi-query.engine.js";

const GOVERNED_QUERY_TIMEOUT_MS = 5_000;

export class BiService {
  private readonly queryEngine = new BiQueryEngine();

  constructor(
    private readonly repo: BiRepository,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  async listDatasets(actor: ActorContext): Promise<BiDataset[]> {
    await this.rbac.requirePermission(actor, "reporting.bi.manage");
    await this.ensureDatasetsProvisioned(actor.tenantId);

    const activeModules = new Set(await this.repo.listActiveModuleCodes(actor.tenantId));
    const datasets = await this.repo.listDatasets(actor.tenantId);
    const authorized: BiDataset[] = [];

    for (const dataset of datasets) {
      const registered = BI_DATASET_REGISTRY.find((candidate) => candidate.code === dataset.code);
      if (!registered || !activeModules.has(registered.moduleCode)) continue;
      try {
        await this.rbac.          requirePermissionsOnActiveAssignment(
          actor,
          this.requiredPermissions(registered),
        );
        authorized.push(dataset);
      } catch {
        // Dataset discovery is capability-filtered: inaccessible datasets are not leaked.
      }
    }

    return authorized;
  }

  async getDatasetDetails(
    actor: ActorContext,
    code: string,
  ): Promise<{ dataset: BiDataset; fields: BiDatasetField[] }> {
    const registered = getRegisteredDataset(code);
    await this.authorizeDataset(actor, registered);
    await this.ensureDatasetsProvisioned(actor.tenantId);

    const dataset = await this.repo.findDatasetByCode(actor.tenantId, code);
    if (!dataset || !dataset.isActive) throw new NotFoundError("BiDataset", code);

    const fields = await this.repo.listDatasetFields(actor.tenantId, dataset.id);
    return { dataset, fields };
  }

  async executeQuery(actor: ActorContext, config: BiQueryConfig): Promise<BiQueryResult> {
    const registered = getRegisteredDataset(config.datasetCode);
    const requiredPermissions = this.requiredPermissions(registered);
    await this.authorizeDataset(actor, registered, requiredPermissions);

    return this.executeAuthorizedQuery(actor, config, requiredPermissions, "reporting.bi.query_executed");
  }

  async exportCsv(
    actor: ActorContext,
    config: BiQueryConfig,
  ): Promise<{ filename: string; csv: string }> {
    const registered = getRegisteredDataset(config.datasetCode);
    const requiredPermissions = this.requiredPermissions(registered, ["reporting.export"]);
    await this.authorizeDataset(actor, registered, requiredPermissions);

    const result = await this.executeAuthorizedQuery(
      actor,
      config,
      requiredPermissions,
      "reporting.bi.csv_exported",
    );

    const header = result.columns.map((column) => csvCell(column.label)).join(",");
    const rows = result.rows.map((row) =>
      result.columns.map((column) => csvCell(row[column.key])).join(","),
    );

    return {
      filename: `bi-export-${config.datasetCode}-${new Date().toISOString().slice(0, 10)}.csv`,
      csv: [header, ...rows].join("\r\n"),
    };
  }

  async createSavedReport(
    actor: ActorContext,
    input: {
      code: string;
      title: string;
      description?: string | null;
      config: BiQueryConfig;
      isShared?: boolean;
    },
  ): Promise<BiSavedReport> {
    const registered = getRegisteredDataset(input.config.datasetCode);
    const requiredPermissions = this.requiredPermissions(registered);
    await this.authorizeDataset(actor, registered, requiredPermissions);
    await this.ensureDatasetsProvisioned(actor.tenantId);

    const dataset = await this.repo.findDatasetByCode(actor.tenantId, registered.code);
    if (!dataset || !dataset.isActive) throw new NotFoundError("BiDataset", registered.code);

    const scope = await this.repo.getScopeProjection(
      actor.tenantId,
      actor.userId,
      requiredPermissions,
    );
    this.queryEngine.compileQuery(actor.tenantId, input.config, scope);

    try {
      const saved = await this.repo.createSavedReport({
        tenantId: actor.tenantId,
        datasetId: dataset.id,
        code: input.code,
        title: input.title,
        description: input.description ?? null,
        config: input.config,
        isShared: input.isShared ?? false,
        createdBy: actor.userId,
      });

      await this.audit.record({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "reporting.bi.saved_report_created",
        entityType: "bi_saved_report",
        entityId: saved.id,
        metadata: { code: saved.code, title: saved.title, datasetCode: registered.code },
      });

      return saved;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(`Saved report code '${input.code}' already exists`);
      }
      throw error;
    }
  }

  async listSavedReports(actor: ActorContext, datasetCode?: string): Promise<BiSavedReport[]> {
    await this.rbac.requirePermission(actor, "reporting.bi.manage");

    if (datasetCode) {
      const registered = getRegisteredDataset(datasetCode);
      await this.authorizeDataset(actor, registered);
      const dataset = await this.repo.findDatasetByCode(actor.tenantId, datasetCode);
      if (!dataset || !dataset.isActive) return [];
      return this.repo.listSavedReports(actor.tenantId, dataset.id);
    }

    const reports = await this.repo.listSavedReports(actor.tenantId);
    const visibleReports: BiSavedReport[] = [];
    for (const report of reports) {
      try {
        const registered = getRegisteredDataset(report.config.datasetCode);
        await this.authorizeDataset(actor, registered);
        visibleReports.push(report);
      } catch {
        // Do not disclose report metadata for inaccessible datasets.
      }
    }
    return visibleReports;
  }

  async getSavedReport(actor: ActorContext, id: string): Promise<BiSavedReport> {
    const report = await this.repo.findSavedReportById(actor.tenantId, id);
    if (!report) throw new NotFoundError("BiSavedReport", id);
    const registered = getRegisteredDataset(report.config.datasetCode);
    await this.authorizeDataset(actor, registered);
    return report;
  }

  async deleteSavedReport(actor: ActorContext, id: string): Promise<void> {
    const report = await this.repo.findSavedReportById(actor.tenantId, id);
    if (!report) throw new NotFoundError("BiSavedReport", id);
    const registered = getRegisteredDataset(report.config.datasetCode);
    await this.authorizeDataset(actor, registered);

    const deleted = await this.repo.deleteSavedReport(actor.tenantId, id);
    if (!deleted) throw new NotFoundError("BiSavedReport", id);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "reporting.bi.saved_report_deleted",
      entityType: "bi_saved_report",
      entityId: id,
      metadata: { datasetCode: registered.code },
    });
  }

  private async executeAuthorizedQuery(
    actor: ActorContext,
    config: BiQueryConfig,
    requiredPermissions: readonly string[],
    auditAction: string,
  ): Promise<BiQueryResult> {
    const scope = await this.repo.getScopeProjection(
      actor.tenantId,
      actor.userId,
      requiredPermissions,
    );
    const { sql, params, columns } = this.queryEngine.compileQuery(actor.tenantId, config, scope);
    const rows = await this.repo.runGovernedQuery(sql, params, GOVERNED_QUERY_TIMEOUT_MS);
    const result = this.queryEngine.formatResult(config.datasetCode, columns, rows);

    await this.ensureDatasetsProvisioned(actor.tenantId);
    const dataset = await this.repo.findDatasetByCode(actor.tenantId, config.datasetCode);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: auditAction,
      entityType: "bi_dataset",
      entityId: dataset?.id ?? null,
      metadata: {
        datasetCode: config.datasetCode,
        dimensions: config.dimensions,
        measures: config.measures,
        rowCount: result.rowCount,
        truncated: result.truncated,
      },
    });

    return result;
  }

  private async authorizeDataset(
    actor: ActorContext,
    dataset: RegisteredDatasetDef,
    requiredPermissions = this.requiredPermissions(dataset),
  ): Promise<void> {
    await this.rbac.requirePermissionsOnActiveAssignment(actor, requiredPermissions);
    const activeModules = await this.repo.listActiveModuleCodes(actor.tenantId);
    if (!activeModules.includes(dataset.moduleCode)) {
      throw new NotFoundError("BiDataset", dataset.code);
    }
  }

  private requiredPermissions(
    dataset: RegisteredDatasetDef,
    additional: readonly string[] = [],
  ): string[] {
    return [...new Set(["reporting.bi.manage", ...dataset.requiredPermissions, ...additional])];
  }

  private async ensureDatasetsProvisioned(tenantId: string): Promise<void> {
    for (const datasetDefinition of BI_DATASET_REGISTRY) {
      const dataset = await this.repo.ensureDatasetProvisioned({
        tenantId,
        code: datasetDefinition.code,
        name: datasetDefinition.name,
        description: datasetDefinition.description,
        moduleCode: datasetDefinition.moduleCode,
        requiredPermissions: datasetDefinition.requiredPermissions,
      });

      for (const field of datasetDefinition.fields) {
        await this.repo.ensureFieldProvisioned({
          tenantId,
          datasetId: dataset.id,
          code: field.code,
          name: field.name,
          fieldType: field.fieldType,
          isDimension: field.isDimension,
          isMeasure: field.isMeasure,
          isFilterable: field.isFilterable,
          aggregation: field.defaultAggregation ?? null,
          sortOrder: field.sortOrder,
        });
      }
    }
  }
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505",
  );
}
