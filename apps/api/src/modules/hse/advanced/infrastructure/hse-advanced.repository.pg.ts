import type { Pool, QueryResultRow } from "pg";
import type {
  AuditFindingType,
  AuditProgrammeType,
  AuditResult,
  CapaActionType,
  CapaStatus,
  ContributingFactor,
  CoreFollowUpRef,
  CoreHseRecordRef,
  CreateAuditProgrammeInput,
  CreateCapaInput,
  CreateIndicatorSnapshotInput,
  CreateInvestigationFrameworkInput,
  CreateInvestigationInput,
  CreateMonitoringPointInput,
  CreatePermitInput,
  CreateRiskAssessmentInput,
  CreateRiskMatrixInput,
  HseAdvancedRepository,
  HseAuditFinding,
  HseAuditOccurrence,
  HseAuditProgramme,
  HseCapa,
  HseCapaAction,
  HseIndicatorSnapshot,
  HseInvestigation,
  HseInvestigationFramework,
  HseMonitoringPoint,
  HseMonitoringReading,
  HsePermit,
  HseRiskAssessment,
  HseRiskMatrix,
  HseRiskMatrixCell,
  IndicatorFacts,
  PermitIsolationCondition,
  RiskAssessmentType,
  RiskControl,
  RiskScalePoint,
  UpdateInvestigationInput,
  UpdatePermitInput,
} from "../domain/hse-advanced.entity.js";

/**
 * HSE Advanced persistence (Wave A7).
 *
 * Three rules shape this file:
 *
 * 1. **No DELETE.** Safety history stays readable (prompt §30). The Core repo
 *    holds the same line and this module does not weaken it.
 * 2. **NUMERIC leaves as text.** `threshold_min`, `value`, `score` and every
 *    rate are cast `::text` in the SELECT list. `pg` would otherwise hand back
 *    a JS `number`, which is exactly the binary float ADR-0026 §5 forbids for
 *    an authoritative amount.
 * 3. **`hse_permits` has no status column.** The only lifecycle write here is
 *    `setPermitWorkflowInstance` (ADR-0027 §4).
 *
 * Data Scope is applied through the `orgUnitIds` argument on every list read:
 * `null` means tenant-wide (no predicate), an empty array means fail-closed and
 * matches nothing. Where a table has no organization unit of its own the
 * predicate goes through its anchor — a CAPA through its HSE record, an
 * occurrence through its programme, a finding through its occurrence.
 */
export class PgHseAdvancedRepository implements HseAdvancedRepository {
  constructor(private readonly pool: Pool) {}

  // =====================================================================
  // HSE-ADV-001 — investigations
  // =====================================================================

  async createInvestigationFramework(
    input: CreateInvestigationFrameworkInput,
  ): Promise<HseInvestigationFramework> {
    const r = await this.pool.query(
      `INSERT INTO hse_investigation_frameworks
         (tenant_id, code, name, description, cause_categories, version, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5::jsonb,
               COALESCE((SELECT MAX(version) + 1 FROM hse_investigation_frameworks
                          WHERE tenant_id = $1 AND code = $2), 1),
               $6)
       RETURNING *`,
      [
        input.tenantId,
        input.code,
        input.name,
        input.description,
        JSON.stringify(input.causeCategories),
        input.createdBy,
      ],
    );
    return toFramework(r.rows[0]);
  }

  async findInvestigationFrameworkById(id: string): Promise<HseInvestigationFramework | null> {
    const r = await this.pool.query(
      `SELECT * FROM hse_investigation_frameworks WHERE id = $1`,
      [id],
    );
    return r.rows[0] ? toFramework(r.rows[0]) : null;
  }

  async listInvestigationFrameworks(tenantId: string): Promise<HseInvestigationFramework[]> {
    const r = await this.pool.query(
      `SELECT * FROM hse_investigation_frameworks
        WHERE tenant_id = $1 AND is_active
        ORDER BY code ASC, version DESC`,
      [tenantId],
    );
    return r.rows.map(toFramework);
  }

  async createInvestigation(input: CreateInvestigationInput): Promise<HseInvestigation> {
    const r = await this.pool.query(
      `INSERT INTO hse_investigations
         (tenant_id, hse_record_id, framework_id, framework_code, framework_version,
          lead_investigator_user_id, created_by_user_id, updated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       RETURNING *`,
      [
        input.tenantId,
        input.hseRecordId,
        input.frameworkId,
        input.frameworkCode,
        input.frameworkVersion,
        input.leadInvestigatorUserId,
        input.createdBy,
      ],
    );
    return toInvestigation(r.rows[0]);
  }

  async findInvestigationById(id: string): Promise<HseInvestigation | null> {
    const r = await this.pool.query(`SELECT * FROM hse_investigations WHERE id = $1`, [id]);
    return r.rows[0] ? toInvestigation(r.rows[0]) : null;
  }

  async findInvestigationByRecord(hseRecordId: string): Promise<HseInvestigation | null> {
    const r = await this.pool.query(
      `SELECT * FROM hse_investigations WHERE hse_record_id = $1`,
      [hseRecordId],
    );
    return r.rows[0] ? toInvestigation(r.rows[0]) : null;
  }

  /**
   * Scope travels through the anchored Core record. An empty `orgUnitIds`
   * therefore excludes every investigation, including one whose record has no
   * organization unit — the fail-closed answer, not a widened one.
   */
  async listInvestigations(
    tenantId: string,
    orgUnitIds: string[] | null,
  ): Promise<HseInvestigation[]> {
    const params: unknown[] = [tenantId];
    let scope = "";
    if (orgUnitIds !== null) {
      params.push(orgUnitIds);
      scope = ` AND EXISTS (
        SELECT 1 FROM hse_records rec
         WHERE rec.id = i.hse_record_id
           AND rec.organization_unit_id = ANY($${params.length}::uuid[])
      )`;
    }
    const r = await this.pool.query(
      `SELECT i.* FROM hse_investigations i
        WHERE i.tenant_id = $1${scope}
        ORDER BY i.started_at DESC`,
      params,
    );
    return r.rows.map(toInvestigation);
  }

  async updateInvestigation(
    id: string,
    input: UpdateInvestigationInput,
  ): Promise<HseInvestigation | null> {
    // framework_code / framework_version are deliberately absent: the framework
    // an investigation was recorded under is history (ADR-0027 §2).
    const r = await this.pool.query(
      `UPDATE hse_investigations
          SET lead_investigator_user_id = COALESCE($2, lead_investigator_user_id),
              findings                  = COALESCE($3, findings),
              root_cause                = COALESCE($4, root_cause),
              contributing_factors      = COALESCE($5::jsonb, contributing_factors),
              concluded_at              = COALESCE($6, concluded_at),
              updated_by_user_id        = $7,
              updated_at                = now()
        WHERE id = $1
        RETURNING *`,
      [
        id,
        input.leadInvestigatorUserId ?? null,
        input.findings ?? null,
        input.rootCause ?? null,
        input.contributingFactors ? JSON.stringify(input.contributingFactors) : null,
        input.concludedAt ?? null,
        input.updatedBy,
      ],
    );
    return r.rows[0] ? toInvestigation(r.rows[0]) : null;
  }

  // =====================================================================
  // HSE-ADV-002 — risk matrix and assessments
  // =====================================================================

  async createRiskMatrix(input: CreateRiskMatrixInput): Promise<HseRiskMatrix> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const m = await client.query(
        `INSERT INTO hse_risk_matrices
           (tenant_id, code, name, likelihood_scale, severity_scale, created_by_user_id)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6)
         RETURNING *`,
        [
          input.tenantId,
          input.code,
          input.name,
          JSON.stringify(input.likelihoodScale),
          JSON.stringify(input.severityScale),
          input.createdBy,
        ],
      );
      // A matrix with a gap in its grid would fail to rate a real combination,
      // so the cells arrive with the matrix in one transaction.
      for (const cell of input.cells) {
        await client.query(
          `INSERT INTO hse_risk_matrix_cells
             (tenant_id, matrix_id, likelihood, severity, band_code, score)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [input.tenantId, m.rows[0].id, cell.likelihood, cell.severity, cell.bandCode, cell.score],
        );
      }
      await client.query("COMMIT");
      return toRiskMatrix(m.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async findRiskMatrixById(id: string): Promise<HseRiskMatrix | null> {
    const r = await this.pool.query(`SELECT * FROM hse_risk_matrices WHERE id = $1`, [id]);
    return r.rows[0] ? toRiskMatrix(r.rows[0]) : null;
  }

  async findActiveRiskMatrix(tenantId: string): Promise<HseRiskMatrix | null> {
    // `uq_hse_risk_matrices_one_active` guarantees at most one, so this needs no
    // ordering tie-break.
    const r = await this.pool.query(
      `SELECT * FROM hse_risk_matrices WHERE tenant_id = $1 AND is_active LIMIT 1`,
      [tenantId],
    );
    return r.rows[0] ? toRiskMatrix(r.rows[0]) : null;
  }

  async listRiskMatrixCells(matrixId: string): Promise<HseRiskMatrixCell[]> {
    const r = await this.pool.query(
      `SELECT id, tenant_id, matrix_id, likelihood, severity, band_code, score::text AS score
         FROM hse_risk_matrix_cells
        WHERE matrix_id = $1
        ORDER BY likelihood ASC, severity ASC`,
      [matrixId],
    );
    return r.rows.map(toMatrixCell);
  }

  async riskMatrixCell(
    matrixId: string,
    likelihood: number,
    severity: number,
  ): Promise<HseRiskMatrixCell | null> {
    const r = await this.pool.query(
      `SELECT id, tenant_id, matrix_id, likelihood, severity, band_code, score::text AS score
         FROM hse_risk_matrix_cells
        WHERE matrix_id = $1 AND likelihood = $2 AND severity = $3`,
      [matrixId, likelihood, severity],
    );
    return r.rows[0] ? toMatrixCell(r.rows[0]) : null;
  }

  async createRiskAssessment(input: CreateRiskAssessmentInput): Promise<HseRiskAssessment> {
    const r = await this.pool.query(
      `INSERT INTO hse_risk_assessments
         (tenant_id, hse_record_id, project_id, assessment_type, title, task_description,
          matrix_id, likelihood, severity, band_code, score, controls,
          residual_likelihood, residual_severity, residual_band_code, residual_score,
          assessed_by_user_id, created_by_user_id, updated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$18)
       RETURNING *`,
      [
        input.tenantId,
        input.hseRecordId,
        input.projectId,
        input.assessmentType,
        input.title,
        input.taskDescription,
        input.matrixId,
        input.likelihood,
        input.severity,
        input.bandCode,
        input.score,
        JSON.stringify(input.controls),
        input.residualLikelihood,
        input.residualSeverity,
        input.residualBandCode,
        input.residualScore,
        input.assessedByUserId,
        input.createdBy,
      ],
    );
    return toRiskAssessment(r.rows[0]);
  }

  async findRiskAssessmentById(id: string): Promise<HseRiskAssessment | null> {
    const r = await this.pool.query(SELECT_ASSESSMENT + ` WHERE id = $1`, [id]);
    return r.rows[0] ? toRiskAssessment(r.rows[0]) : null;
  }

  /**
   * An assessment with no organization unit of its own follows its anchors: the
   * Core record's when it has one, else the project's owning unit. A stand-alone
   * assessment that resolves to neither is excluded under a scoped session,
   * because the alternative is authorizing it on nothing.
   */
  async listRiskAssessments(
    tenantId: string,
    filter: { hseRecordId?: string; projectId?: string },
    orgUnitIds: string[] | null,
  ): Promise<HseRiskAssessment[]> {
    const params: unknown[] = [tenantId];
    let sql = SELECT_ASSESSMENT + ` WHERE a.tenant_id = $1`;
    if (filter.hseRecordId) {
      params.push(filter.hseRecordId);
      sql += ` AND a.hse_record_id = $${params.length}`;
    }
    if (filter.projectId) {
      params.push(filter.projectId);
      sql += ` AND a.project_id = $${params.length}`;
    }
    if (orgUnitIds !== null) {
      params.push(orgUnitIds);
      sql += ` AND (EXISTS (
                   SELECT 1 FROM hse_records rec
                    WHERE rec.id = a.hse_record_id
                      AND rec.organization_unit_id = ANY($${params.length}::uuid[])
                 )
                 OR EXISTS (
                   SELECT 1 FROM projects p
                    WHERE p.id = a.project_id
                      AND p.organization_unit_id = ANY($${params.length}::uuid[])
                 ))`;
    }
    sql += ` ORDER BY a.assessed_at DESC`;
    const r = await this.pool.query(sql, params);
    return r.rows.map(toRiskAssessment);
  }

  // =====================================================================
  // HSE-ADV-003 — permits
  // =====================================================================

  async createPermit(input: CreatePermitInput): Promise<HsePermit> {
    const r = await this.pool.query(
      `INSERT INTO hse_permits
         (tenant_id, permit_number, permit_type_code, title, description,
          organization_unit_id, project_id, site_id, location_detail,
          valid_from, valid_to, isolation_conditions, risk_assessment_id,
          requested_by_user_id, created_by_user_id, updated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$15)
       RETURNING *`,
      [
        input.tenantId,
        input.permitNumber,
        input.permitTypeCode,
        input.title,
        input.description,
        input.organizationUnitId,
        input.projectId,
        input.siteId,
        input.locationDetail,
        input.validFrom,
        input.validTo,
        JSON.stringify(input.isolationConditions),
        input.riskAssessmentId,
        input.requestedByUserId,
        input.createdBy,
      ],
    );
    return toPermit(r.rows[0]);
  }

  async findPermitById(id: string): Promise<HsePermit | null> {
    const r = await this.pool.query(`SELECT * FROM hse_permits WHERE id = $1`, [id]);
    return r.rows[0] ? toPermit(r.rows[0]) : null;
  }

  async findPermitByNumber(tenantId: string, permitNumber: string): Promise<HsePermit | null> {
    const r = await this.pool.query(
      `SELECT * FROM hse_permits WHERE tenant_id = $1 AND permit_number = $2`,
      [tenantId, permitNumber],
    );
    return r.rows[0] ? toPermit(r.rows[0]) : null;
  }

  async listPermits(tenantId: string, orgUnitIds: string[] | null): Promise<HsePermit[]> {
    const params: unknown[] = [tenantId];
    let scope = "";
    if (orgUnitIds !== null) {
      params.push(orgUnitIds);
      scope = ` AND organization_unit_id = ANY($${params.length}::uuid[])`;
    }
    const r = await this.pool.query(
      `SELECT * FROM hse_permits
        WHERE tenant_id = $1${scope}
        ORDER BY valid_from DESC`,
      params,
    );
    return r.rows.map(toPermit);
  }

  async updatePermit(id: string, input: UpdatePermitInput): Promise<HsePermit | null> {
    // No status column exists to update. `workflow_instance_id` is not settable
    // here either — that is `setPermitWorkflowInstance` alone (ADR-0027 §4).
    const r = await this.pool.query(
      `UPDATE hse_permits
          SET permit_type_code     = COALESCE($2, permit_type_code),
              title                = COALESCE($3, title),
              description          = COALESCE($4, description),
              organization_unit_id = COALESCE($5, organization_unit_id),
              project_id           = COALESCE($6, project_id),
              site_id              = COALESCE($7, site_id),
              location_detail      = COALESCE($8, location_detail),
              valid_from           = COALESCE($9, valid_from),
              valid_to             = COALESCE($10, valid_to),
              isolation_conditions = COALESCE($11::jsonb, isolation_conditions),
              risk_assessment_id   = COALESCE($12, risk_assessment_id),
              updated_by_user_id   = $13,
              updated_at           = now()
        WHERE id = $1
        RETURNING *`,
      [
        id,
        input.permitTypeCode ?? null,
        input.title ?? null,
        input.description ?? null,
        input.organizationUnitId ?? null,
        input.projectId ?? null,
        input.siteId ?? null,
        input.locationDetail ?? null,
        input.validFrom ?? null,
        input.validTo ?? null,
        input.isolationConditions ? JSON.stringify(input.isolationConditions) : null,
        input.riskAssessmentId ?? null,
        input.updatedBy,
      ],
    );
    return r.rows[0] ? toPermit(r.rows[0]) : null;
  }

  async setPermitWorkflowInstance(id: string, workflowInstanceId: string): Promise<void> {
    await this.pool.query(
      `UPDATE hse_permits
          SET workflow_instance_id = $2, updated_at = now()
        WHERE id = $1`,
      [id, workflowInstanceId],
    );
  }

  // =====================================================================
  // HSE-ADV-004 — programmes, occurrences, findings
  // =====================================================================

  async createAuditProgramme(input: CreateAuditProgrammeInput): Promise<HseAuditProgramme> {
    const r = await this.pool.query(
      `INSERT INTO hse_audit_programmes
         (tenant_id, code, name, description, programme_type, frequency_days, checklist,
          organization_unit_id, site_id, owner_user_id,
          created_by_user_id, updated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$11)
       RETURNING *`,
      [
        input.tenantId,
        input.code,
        input.name,
        input.description,
        input.programmeType,
        input.frequencyDays,
        JSON.stringify(input.checklist),
        input.organizationUnitId,
        input.siteId,
        input.ownerUserId,
        input.createdBy,
      ],
    );
    return toProgramme(r.rows[0]);
  }

  async findAuditProgrammeById(id: string): Promise<HseAuditProgramme | null> {
    const r = await this.pool.query(`SELECT * FROM hse_audit_programmes WHERE id = $1`, [id]);
    return r.rows[0] ? toProgramme(r.rows[0]) : null;
  }

  async listAuditProgrammes(
    tenantId: string,
    orgUnitIds: string[] | null,
  ): Promise<HseAuditProgramme[]> {
    const params: unknown[] = [tenantId];
    let scope = "";
    if (orgUnitIds !== null) {
      params.push(orgUnitIds);
      scope = ` AND organization_unit_id = ANY($${params.length}::uuid[])`;
    }
    const r = await this.pool.query(
      `SELECT * FROM hse_audit_programmes
        WHERE tenant_id = $1${scope}
        ORDER BY code ASC`,
      params,
    );
    return r.rows.map(toProgramme);
  }

  async createAuditOccurrence(input: {
    tenantId: string;
    programmeId: string;
    scheduledFor: string;
  }): Promise<HseAuditOccurrence> {
    const r = await this.pool.query(
      `INSERT INTO hse_audit_occurrences (tenant_id, programme_id, scheduled_for)
       VALUES ($1,$2,$3)
       RETURNING *`,
      [input.tenantId, input.programmeId, input.scheduledFor],
    );
    return toOccurrence(r.rows[0]);
  }

  async findAuditOccurrenceById(id: string): Promise<HseAuditOccurrence | null> {
    const r = await this.pool.query(`SELECT * FROM hse_audit_occurrences WHERE id = $1`, [id]);
    return r.rows[0] ? toOccurrence(r.rows[0]) : null;
  }

  async listAuditOccurrences(programmeId: string): Promise<HseAuditOccurrence[]> {
    const r = await this.pool.query(
      `SELECT * FROM hse_audit_occurrences
        WHERE programme_id = $1
        ORDER BY scheduled_for DESC`,
      [programmeId],
    );
    return r.rows.map(toOccurrence);
  }

  async completeAuditOccurrence(input: {
    tenantId: string;
    occurrenceId: string;
    performedAt: Date;
    performedBy: string;
    results: AuditResult[];
    notes: string | null;
  }): Promise<HseAuditOccurrence | null> {
    const r = await this.pool.query(
      `UPDATE hse_audit_occurrences
          SET performed_at         = $3,
              performed_by_user_id = $4,
              results              = $5::jsonb,
              notes                = $6,
              updated_at           = now()
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [
        input.occurrenceId,
        input.tenantId,
        input.performedAt,
        input.performedBy,
        JSON.stringify(input.results),
        input.notes,
      ],
    );
    return r.rows[0] ? toOccurrence(r.rows[0]) : null;
  }

  async createAuditFinding(input: {
    tenantId: string;
    occurrenceId: string;
    findingType: AuditFindingType;
    checklistItemCode: string | null;
    description: string;
    createdBy: string | null;
  }): Promise<HseAuditFinding> {
    const r = await this.pool.query(
      `INSERT INTO hse_audit_findings
         (tenant_id, occurrence_id, finding_type, checklist_item_code, description,
          created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        input.tenantId,
        input.occurrenceId,
        input.findingType,
        input.checklistItemCode,
        input.description,
        input.createdBy,
      ],
    );
    return toFinding(r.rows[0]);
  }

  async findAuditFindingById(id: string): Promise<HseAuditFinding | null> {
    const r = await this.pool.query(`SELECT * FROM hse_audit_findings WHERE id = $1`, [id]);
    return r.rows[0] ? toFinding(r.rows[0]) : null;
  }

  async listAuditFindings(occurrenceId: string): Promise<HseAuditFinding[]> {
    const r = await this.pool.query(
      `SELECT * FROM hse_audit_findings WHERE occurrence_id = $1 ORDER BY created_at ASC`,
      [occurrenceId],
    );
    return r.rows.map(toFinding);
  }

  // =====================================================================
  // HSE-ADV-005 — monitoring
  // =====================================================================

  async createMonitoringPoint(input: CreateMonitoringPointInput): Promise<HseMonitoringPoint> {
    const r = await this.pool.query(
      `INSERT INTO hse_monitoring_points
         (tenant_id, code, name, parameter_code, unit, threshold_min, threshold_max,
          organization_unit_id, site_id, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING ${SELECT_POINT_COLUMNS}`,
      [
        input.tenantId,
        input.code,
        input.name,
        input.parameterCode,
        input.unit,
        input.thresholdMin,
        input.thresholdMax,
        input.organizationUnitId,
        input.siteId,
        input.createdBy,
      ],
    );
    return toMonitoringPoint(r.rows[0]);
  }

  async findMonitoringPointById(id: string): Promise<HseMonitoringPoint | null> {
    const r = await this.pool.query(
      `SELECT ${SELECT_POINT_COLUMNS} FROM hse_monitoring_points WHERE id = $1`,
      [id],
    );
    return r.rows[0] ? toMonitoringPoint(r.rows[0]) : null;
  }

  async listMonitoringPoints(
    tenantId: string,
    orgUnitIds: string[] | null,
  ): Promise<HseMonitoringPoint[]> {
    const params: unknown[] = [tenantId];
    let scope = "";
    if (orgUnitIds !== null) {
      params.push(orgUnitIds);
      scope = ` AND organization_unit_id = ANY($${params.length}::uuid[])`;
    }
    const r = await this.pool.query(
      `SELECT ${SELECT_POINT_COLUMNS} FROM hse_monitoring_points
        WHERE tenant_id = $1${scope}
        ORDER BY code ASC`,
      params,
    );
    return r.rows.map(toMonitoringPoint);
  }

  async createMonitoringReading(input: {
    tenantId: string;
    pointId: string;
    measuredAt: Date;
    value: string;
    isBreach: boolean;
    recordedBy: string | null;
    note: string | null;
  }): Promise<HseMonitoringReading> {
    const r = await this.pool.query(
      `INSERT INTO hse_monitoring_readings
         (tenant_id, point_id, measured_at, value, is_breach, recorded_by_user_id, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING ${SELECT_READING_COLUMNS}`,
      [
        input.tenantId,
        input.pointId,
        input.measuredAt,
        input.value,
        input.isBreach,
        input.recordedBy,
        input.note,
      ],
    );
    return toMonitoringReading(r.rows[0]);
  }

  async findMonitoringReadingById(id: string): Promise<HseMonitoringReading | null> {
    const r = await this.pool.query(
      `SELECT ${SELECT_READING_COLUMNS} FROM hse_monitoring_readings WHERE id = $1`,
      [id],
    );
    return r.rows[0] ? toMonitoringReading(r.rows[0]) : null;
  }

  async listMonitoringReadings(pointId: string, limit: number): Promise<HseMonitoringReading[]> {
    const r = await this.pool.query(
      `SELECT ${SELECT_READING_COLUMNS} FROM hse_monitoring_readings
        WHERE point_id = $1
        ORDER BY measured_at DESC
        LIMIT $2`,
      [pointId, limit],
    );
    return r.rows.map(toMonitoringReading);
  }

  // =====================================================================
  // HSE-ADV-006 — CAPA
  // =====================================================================

  async createCapa(input: CreateCapaInput): Promise<HseCapa> {
    const r = await this.pool.query(
      `INSERT INTO hse_capas
         (tenant_id, capa_number, title, description, hse_record_id, investigation_id,
          audit_finding_id, monitoring_reading_id, core_follow_up_id, root_cause,
          action_type, owner_user_id, due_date, created_by_user_id, updated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
       RETURNING *, due_date::text AS due_date`,
      [
        input.tenantId,
        input.capaNumber,
        input.title,
        input.description,
        input.hseRecordId,
        input.investigationId,
        input.auditFindingId,
        input.monitoringReadingId,
        input.coreFollowUpId,
        input.rootCause,
        input.actionType,
        input.ownerUserId,
        input.dueDate,
        input.createdBy,
      ],
    );
    return toCapa(r.rows[0]);
  }

  async findCapaById(id: string): Promise<HseCapa | null> {
    const r = await this.pool.query(SELECT_CAPA + ` WHERE c.id = $1`, [id]);
    return r.rows[0] ? toCapa(r.rows[0]) : null;
  }

  async findCapaByNumber(tenantId: string, capaNumber: string): Promise<HseCapa | null> {
    const r = await this.pool.query(
      SELECT_CAPA + ` WHERE c.tenant_id = $1 AND c.capa_number = $2`,
      [tenantId, capaNumber],
    );
    return r.rows[0] ? toCapa(r.rows[0]) : null;
  }

  /**
   * A CAPA carries no organization unit of its own, so scope resolves through
   * whichever anchor raised it. A CAPA whose anchor chain reaches no unit is
   * excluded under a scoped session — never authorized on nothing.
   */
  async listCapas(tenantId: string, orgUnitIds: string[] | null): Promise<HseCapa[]> {
    const params: unknown[] = [tenantId];
    let scope = "";
    if (orgUnitIds !== null) {
      params.push(orgUnitIds);
      const p = `$${params.length}::uuid[]`;
      scope = ` AND (EXISTS (
                   SELECT 1 FROM hse_records rec
                    WHERE rec.id = c.hse_record_id
                      AND rec.organization_unit_id = ANY(${p})
                 )
                 OR EXISTS (
                   SELECT 1 FROM hse_investigations inv
                     JOIN hse_records rec2 ON rec2.id = inv.hse_record_id
                    WHERE inv.id = c.investigation_id
                      AND rec2.organization_unit_id = ANY(${p})
                 )
                 OR EXISTS (
                   SELECT 1 FROM hse_audit_findings f
                     JOIN hse_audit_occurrences o ON o.id = f.occurrence_id
                     JOIN hse_audit_programmes pr ON pr.id = o.programme_id
                    WHERE f.id = c.audit_finding_id
                      AND pr.organization_unit_id = ANY(${p})
                 )
                 OR EXISTS (
                   SELECT 1 FROM hse_monitoring_readings mr
                     JOIN hse_monitoring_points mp ON mp.id = mr.point_id
                    WHERE mr.id = c.monitoring_reading_id
                      AND mp.organization_unit_id = ANY(${p})
                 ))`;
    }
    const r = await this.pool.query(
      SELECT_CAPA + ` WHERE c.tenant_id = $1${scope} ORDER BY c.created_at DESC`,
      params,
    );
    return r.rows.map(toCapa);
  }

  async updateCapaStatus(input: {
    tenantId: string;
    capaId: string;
    status: CapaStatus;
    verificationNotes?: string | null;
    verifiedAt?: Date | null;
    verifiedBy?: string | null;
    closedAt?: Date | null;
    updatedBy: string | null;
  }): Promise<HseCapa | null> {
    const r = await this.pool.query(
      `UPDATE hse_capas
          SET status              = $3,
              verification_notes  = COALESCE($4, verification_notes),
              verified_at         = COALESCE($5, verified_at),
              verified_by_user_id = COALESCE($6, verified_by_user_id),
              closed_at           = COALESCE($7, closed_at),
              updated_by_user_id  = $8,
              updated_at          = now()
        WHERE id = $1 AND tenant_id = $2
        RETURNING *, due_date::text AS due_date`,
      [
        input.capaId,
        input.tenantId,
        input.status,
        input.verificationNotes ?? null,
        input.verifiedAt ?? null,
        input.verifiedBy ?? null,
        input.closedAt ?? null,
        input.updatedBy,
      ],
    );
    return r.rows[0] ? toCapa(r.rows[0]) : null;
  }

  async createCapaAction(input: {
    tenantId: string;
    capaId: string;
    description: string;
    ownerUserId: string | null;
    dueDate: string | null;
    createdBy: string | null;
  }): Promise<HseCapaAction> {
    const r = await this.pool.query(
      `INSERT INTO hse_capa_actions
         (tenant_id, capa_id, description, owner_user_id, due_date, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *, due_date::text AS due_date`,
      [
        input.tenantId,
        input.capaId,
        input.description,
        input.ownerUserId,
        input.dueDate,
        input.createdBy,
      ],
    );
    return toCapaAction(r.rows[0]);
  }

  async listCapaActions(capaId: string): Promise<HseCapaAction[]> {
    const r = await this.pool.query(
      `SELECT *, due_date::text AS due_date FROM hse_capa_actions
        WHERE capa_id = $1
        ORDER BY created_at ASC`,
      [capaId],
    );
    return r.rows.map(toCapaAction);
  }

  async completeCapaAction(input: {
    tenantId: string;
    actionId: string;
    completedAt: Date;
    completionNotes: string | null;
  }): Promise<HseCapaAction | null> {
    const r = await this.pool.query(
      `UPDATE hse_capa_actions
          SET completed_at     = $3,
              completion_notes = $4,
              updated_at       = now()
        WHERE id = $1 AND tenant_id = $2
        RETURNING *, due_date::text AS due_date`,
      [input.actionId, input.tenantId, input.completedAt, input.completionNotes],
    );
    return r.rows[0] ? toCapaAction(r.rows[0]) : null;
  }

  // =====================================================================
  // HSE-ADV-007 — indicator snapshots
  // =====================================================================

  async createIndicatorSnapshot(
    input: CreateIndicatorSnapshotInput,
  ): Promise<HseIndicatorSnapshot> {
    const r = await this.pool.query(
      `INSERT INTO hse_indicator_snapshots
         (tenant_id, organization_unit_id, window_start, window_end, exposure_hours,
          near_miss_count, observation_count, inspection_count,
          capa_opened_count, capa_closed_count, capa_closure_rate, permit_count,
          incident_count, lost_time_incident_count, lost_days,
          incident_frequency_rate, severity_rate, computed_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING ${SELECT_INDICATOR_COLUMNS}`,
      [
        input.tenantId,
        input.organizationUnitId,
        input.windowStart,
        input.windowEnd,
        input.exposureHours,
        input.nearMissCount,
        input.observationCount,
        input.inspectionCount,
        input.capaOpenedCount,
        input.capaClosedCount,
        input.capaClosureRate,
        input.permitCount,
        input.incidentCount,
        input.lostTimeIncidentCount,
        input.lostDays,
        input.incidentFrequencyRate,
        input.severityRate,
        input.computedBy,
      ],
    );
    return toIndicatorSnapshot(r.rows[0]);
  }

  async findIndicatorSnapshotById(id: string): Promise<HseIndicatorSnapshot | null> {
    const r = await this.pool.query(
      `SELECT ${SELECT_INDICATOR_COLUMNS} FROM hse_indicator_snapshots WHERE id = $1`,
      [id],
    );
    return r.rows[0] ? toIndicatorSnapshot(r.rows[0]) : null;
  }

  async listIndicatorSnapshots(
    tenantId: string,
    orgUnitIds: string[] | null,
  ): Promise<HseIndicatorSnapshot[]> {
    const params: unknown[] = [tenantId];
    let scope = "";
    if (orgUnitIds !== null) {
      params.push(orgUnitIds);
      scope = ` AND organization_unit_id = ANY($${params.length}::uuid[])`;
    }
    const r = await this.pool.query(
      `SELECT ${SELECT_INDICATOR_COLUMNS} FROM hse_indicator_snapshots
        WHERE tenant_id = $1${scope}
        ORDER BY window_end DESC, created_at DESC`,
      params,
    );
    return r.rows.map(toIndicatorSnapshot);
  }

  /**
   * One pass over the recorded facts a window covers.
   *
   * Every count is anchored to the window by the timestamp that actually dates
   * the fact — an incident by when it occurred, a CAPA by when it was opened or
   * closed, an occurrence by when it was scheduled. Counting a permit by
   * `valid_from` would credit one issued before the window but active inside
   * it, which is a different question than "how much permitted work started".
   */
  async gatherIndicatorFacts(input: {
    tenantId: string;
    windowStart: string;
    windowEnd: string;
    organizationUnitId: string | null;
    orgUnitIds: string[] | null;
    nearMissCategoryCode: string | null;
    lostTimeSeverityCode: string | null;
  }): Promise<IndicatorFacts> {
    // An explicit organization unit narrows to it; otherwise the actor's scope
    // applies. Both are expressed as one optional array so the SQL is uniform.
    const scopeIds = input.organizationUnitId
      ? [input.organizationUnitId]
      : (input.orgUnitIds ?? null);

    const r = await this.pool.query(
      `WITH scope AS (
         SELECT $4::uuid[] AS ids
       )
       SELECT
         (SELECT count(*) FROM hse_records rec, scope
           WHERE rec.tenant_id = $1
             AND rec.record_type = 'incident'
             AND rec.occurred_at >= $2::timestamptz
             AND rec.occurred_at < ($3::date + INTERVAL '1 day')
             AND (scope.ids IS NULL OR rec.organization_unit_id = ANY(scope.ids))
         )::int AS incident_count,
         (SELECT count(*) FROM hse_records rec, scope
           WHERE rec.tenant_id = $1
             AND rec.record_type = 'incident'
             AND rec.occurred_at >= $2::timestamptz
             AND rec.occurred_at < ($3::date + INTERVAL '1 day')
             AND $5::text IS NOT NULL
             AND rec.category_code = $5
             AND (scope.ids IS NULL OR rec.organization_unit_id = ANY(scope.ids))
         )::int AS near_miss_count,
         (SELECT count(*) FROM hse_records rec, scope
           WHERE rec.tenant_id = $1
             AND rec.record_type = 'observation'
             AND rec.occurred_at >= $2::timestamptz
             AND rec.occurred_at < ($3::date + INTERVAL '1 day')
             AND (scope.ids IS NULL OR rec.organization_unit_id = ANY(scope.ids))
         )::int AS observation_count,
         (SELECT count(*) FROM hse_records rec, scope
           WHERE rec.tenant_id = $1
             AND rec.record_type = 'incident'
             AND rec.occurred_at >= $2::timestamptz
             AND rec.occurred_at < ($3::date + INTERVAL '1 day')
             AND $6::text IS NOT NULL
             AND rec.severity_code = $6
             AND (scope.ids IS NULL OR rec.organization_unit_id = ANY(scope.ids))
         )::int AS lost_time_incident_count,
         (SELECT count(*) FROM hse_audit_occurrences o
            JOIN hse_audit_programmes pr ON pr.id = o.programme_id, scope
           WHERE o.tenant_id = $1
             AND o.performed_at >= $2::timestamptz
             AND o.performed_at < ($3::date + INTERVAL '1 day')
             AND (scope.ids IS NULL OR pr.organization_unit_id = ANY(scope.ids))
         )::int AS inspection_count,
         (SELECT count(*) FROM hse_permits p, scope
           WHERE p.tenant_id = $1
             AND p.valid_from >= $2::timestamptz
             AND p.valid_from < ($3::date + INTERVAL '1 day')
             AND (scope.ids IS NULL OR p.organization_unit_id = ANY(scope.ids))
         )::int AS permit_count,
         (SELECT count(*) FROM hse_capas c, scope
           WHERE c.tenant_id = $1
             AND c.created_at >= $2::timestamptz
             AND c.created_at < ($3::date + INTERVAL '1 day')
             AND (scope.ids IS NULL OR EXISTS (
                   SELECT 1 FROM hse_records rec2
                    WHERE rec2.id = c.hse_record_id
                      AND rec2.organization_unit_id = ANY(scope.ids)))
         )::int AS capa_opened_count,
         (SELECT count(*) FROM hse_capas c, scope
           WHERE c.tenant_id = $1
             AND c.closed_at >= $2::timestamptz
             AND c.closed_at < ($3::date + INTERVAL '1 day')
             AND (scope.ids IS NULL OR EXISTS (
                   SELECT 1 FROM hse_records rec2
                    WHERE rec2.id = c.hse_record_id
                      AND rec2.organization_unit_id = ANY(scope.ids)))
         )::int AS capa_closed_count`,
      [
        input.tenantId,
        `${input.windowStart}T00:00:00.000Z`,
        input.windowEnd,
        scopeIds,
        input.nearMissCategoryCode,
        input.lostTimeSeverityCode,
      ],
    );

    const row = r.rows[0] ?? {};
    return {
      incidentCount: Number(row.incident_count ?? 0),
      nearMissCount: Number(row.near_miss_count ?? 0),
      observationCount: Number(row.observation_count ?? 0),
      lostTimeIncidentCount: Number(row.lost_time_incident_count ?? 0),
      inspectionCount: Number(row.inspection_count ?? 0),
      permitCount: Number(row.permit_count ?? 0),
      capaOpenedCount: Number(row.capa_opened_count ?? 0),
      capaClosedCount: Number(row.capa_closed_count ?? 0),
    };
  }

  // =====================================================================
  // Cross-domain reads (clean ports — nothing domain-internal is imported)
  // =====================================================================

  async findCoreRecord(tenantId: string, hseRecordId: string): Promise<CoreHseRecordRef | null> {
    const r = await this.pool.query(
      `SELECT id, tenant_id, record_number, record_type, organization_unit_id, project_id
         FROM hse_records
        WHERE id = $1 AND tenant_id = $2`,
      [hseRecordId, tenantId],
    );
    if (!r.rows[0]) return null;
    const row = r.rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      recordNumber: row.record_number,
      recordType: row.record_type,
      organizationUnitId: row.organization_unit_id,
      projectId: row.project_id,
    };
  }

  async findCoreFollowUp(tenantId: string, followUpId: string): Promise<CoreFollowUpRef | null> {
    const r = await this.pool.query(
      `SELECT fu.id, fu.tenant_id, fu.hse_record_id, fu.title, fu.completed_at
         FROM hse_follow_ups fu
         JOIN hse_records rec ON rec.id = fu.hse_record_id
        WHERE fu.id = $1 AND rec.tenant_id = $2`,
      [followUpId, tenantId],
    );
    if (!r.rows[0]) return null;
    const row = r.rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      hseRecordId: row.hse_record_id,
      title: row.title,
      completedAt: row.completed_at,
    };
  }

  async projectExists(tenantId: string, projectId: string): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT 1 FROM projects WHERE id = $1 AND tenant_id = $2`,
      [projectId, tenantId],
    );
    return r.rowCount === 1;
  }

  async organizationUnitExists(tenantId: string, id: string): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT 1 FROM organization_units WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return r.rowCount === 1;
  }

  async siteExists(tenantId: string, id: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM sites WHERE id = $1 AND tenant_id = $2`, [
      id,
      tenantId,
    ]);
    return r.rowCount === 1;
  }

  async userExists(tenantId: string, id: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2`, [
      id,
      tenantId,
    ]);
    return r.rowCount === 1;
  }
}

// ---------------------------------------------------------------------------
// SELECT shapes (NUMERIC columns cast to text, per ADR-0026 §5)
// ---------------------------------------------------------------------------

const SELECT_ASSESSMENT = `
  SELECT a.id, a.tenant_id, a.hse_record_id, a.project_id, a.assessment_type, a.title,
         a.task_description, a.matrix_id, a.likelihood, a.severity, a.band_code,
         a.score::text AS score, a.controls, a.residual_likelihood, a.residual_severity,
         a.residual_band_code, a.residual_score::text AS residual_score,
         a.assessed_by_user_id, a.assessed_at, a.created_at, a.updated_at
    FROM hse_risk_assessments a`;

const SELECT_CAPA = `
  SELECT c.id, c.tenant_id, c.capa_number, c.title, c.description, c.hse_record_id,
         c.investigation_id, c.audit_finding_id, c.monitoring_reading_id,
         c.core_follow_up_id, c.root_cause, c.action_type, c.status, c.owner_user_id,
         c.due_date::text AS due_date, c.verification_notes, c.verified_at,
         c.verified_by_user_id, c.closed_at, c.created_at, c.updated_at
    FROM hse_capas c`;

const SELECT_READING_COLUMNS = `id, tenant_id, point_id, measured_at,
  value::text AS value, is_breach, recorded_by_user_id, note, created_at`;

const SELECT_POINT_COLUMNS = `id, tenant_id, code, name, parameter_code, unit,
  threshold_min::text AS threshold_min, threshold_max::text AS threshold_max,
  organization_unit_id, site_id, is_active, created_at, updated_at`;

const SELECT_INDICATOR_COLUMNS = `id, tenant_id, organization_unit_id,
  window_start::text AS window_start, window_end::text AS window_end,
  exposure_hours::text AS exposure_hours,
  near_miss_count, observation_count, inspection_count,
  capa_opened_count, capa_closed_count, capa_closure_rate::text AS capa_closure_rate,
  permit_count, incident_count, lost_time_incident_count, lost_days,
  incident_frequency_rate::text AS incident_frequency_rate,
  severity_rate::text AS severity_rate, created_at`;

function toFramework(row: QueryResultRow): HseInvestigationFramework {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    description: row.description,
    causeCategories: (row.cause_categories ?? []) as string[],
    version: Number(row.version),
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toInvestigation(row: QueryResultRow): HseInvestigation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    hseRecordId: row.hse_record_id,
    frameworkId: row.framework_id,
    frameworkCode: row.framework_code,
    frameworkVersion: Number(row.framework_version),
    leadInvestigatorUserId: row.lead_investigator_user_id,
    startedAt: row.started_at,
    concludedAt: row.concluded_at,
    findings: row.findings,
    rootCause: row.root_cause,
    contributingFactors: (row.contributing_factors ?? []) as ContributingFactor[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRiskMatrix(row: QueryResultRow): HseRiskMatrix {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    likelihoodScale: (row.likelihood_scale ?? []) as RiskScalePoint[],
    severityScale: (row.severity_scale ?? []) as RiskScalePoint[],
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMatrixCell(row: QueryResultRow): HseRiskMatrixCell {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    matrixId: row.matrix_id,
    likelihood: Number(row.likelihood),
    severity: Number(row.severity),
    bandCode: row.band_code,
    score: row.score,
  };
}

function toRiskAssessment(row: QueryResultRow): HseRiskAssessment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    hseRecordId: row.hse_record_id,
    projectId: row.project_id,
    assessmentType: row.assessment_type as RiskAssessmentType,
    title: row.title,
    taskDescription: row.task_description,
    matrixId: row.matrix_id,
    likelihood: Number(row.likelihood),
    severity: Number(row.severity),
    bandCode: row.band_code,
    score: row.score,
    controls: (row.controls ?? []) as RiskControl[],
    residualLikelihood: row.residual_likelihood === null ? null : Number(row.residual_likelihood),
    residualSeverity: row.residual_severity === null ? null : Number(row.residual_severity),
    residualBandCode: row.residual_band_code,
    residualScore: row.residual_score,
    assessedByUserId: row.assessed_by_user_id,
    assessedAt: row.assessed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPermit(row: QueryResultRow): HsePermit {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    permitNumber: row.permit_number,
    permitTypeCode: row.permit_type_code,
    title: row.title,
    description: row.description,
    organizationUnitId: row.organization_unit_id,
    projectId: row.project_id,
    siteId: row.site_id,
    locationDetail: row.location_detail,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    isolationConditions: (row.isolation_conditions ?? []) as PermitIsolationCondition[],
    riskAssessmentId: row.risk_assessment_id,
    workflowInstanceId: row.workflow_instance_id,
    requestedByUserId: row.requested_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toProgramme(row: QueryResultRow): HseAuditProgramme {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    description: row.description,
    programmeType: row.programme_type as AuditProgrammeType,
    frequencyDays: Number(row.frequency_days),
    checklist: (row.checklist ?? []) as HseAuditProgramme["checklist"],
    organizationUnitId: row.organization_unit_id,
    siteId: row.site_id,
    ownerUserId: row.owner_user_id,
    isActive: row.is_active,
    lastScheduledFor: toDateString(row.last_scheduled_for),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOccurrence(row: QueryResultRow): HseAuditOccurrence {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    programmeId: row.programme_id,
    scheduledFor: toDateString(row.scheduled_for) as string,
    performedAt: row.performed_at,
    performedByUserId: row.performed_by_user_id,
    results: (row.results ?? []) as AuditResult[],
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toFinding(row: QueryResultRow): HseAuditFinding {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    occurrenceId: row.occurrence_id,
    findingType: row.finding_type as AuditFindingType,
    checklistItemCode: row.checklist_item_code,
    description: row.description,
    createdAt: row.created_at,
  };
}

function toMonitoringPoint(row: QueryResultRow): HseMonitoringPoint {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    parameterCode: row.parameter_code,
    unit: row.unit,
    thresholdMin: row.threshold_min,
    thresholdMax: row.threshold_max,
    organizationUnitId: row.organization_unit_id,
    siteId: row.site_id,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMonitoringReading(row: QueryResultRow): HseMonitoringReading {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    pointId: row.point_id,
    measuredAt: row.measured_at,
    value: row.value,
    isBreach: row.is_breach,
    recordedByUserId: row.recorded_by_user_id,
    note: row.note,
    createdAt: row.created_at,
  };
}

function toCapa(row: QueryResultRow): HseCapa {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    capaNumber: row.capa_number,
    title: row.title,
    description: row.description,
    hseRecordId: row.hse_record_id,
    investigationId: row.investigation_id,
    auditFindingId: row.audit_finding_id,
    monitoringReadingId: row.monitoring_reading_id,
    coreFollowUpId: row.core_follow_up_id,
    rootCause: row.root_cause,
    actionType: row.action_type as CapaActionType,
    status: row.status as CapaStatus,
    ownerUserId: row.owner_user_id,
    dueDate: toDateString(row.due_date),
    verificationNotes: row.verification_notes,
    verifiedAt: row.verified_at,
    verifiedByUserId: row.verified_by_user_id,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCapaAction(row: QueryResultRow): HseCapaAction {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    capaId: row.capa_id,
    description: row.description,
    ownerUserId: row.owner_user_id,
    dueDate: toDateString(row.due_date),
    completedAt: row.completed_at,
    completionNotes: row.completion_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toIndicatorSnapshot(row: QueryResultRow): HseIndicatorSnapshot {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    organizationUnitId: row.organization_unit_id,
    windowStart: toDateString(row.window_start) as string,
    windowEnd: toDateString(row.window_end) as string,
    exposureHours: row.exposure_hours,
    nearMissCount: Number(row.near_miss_count),
    observationCount: Number(row.observation_count),
    inspectionCount: Number(row.inspection_count),
    capaOpenedCount: Number(row.capa_opened_count),
    capaClosedCount: Number(row.capa_closed_count),
    capaClosureRate: row.capa_closure_rate,
    permitCount: Number(row.permit_count),
    incidentCount: Number(row.incident_count),
    lostTimeIncidentCount: Number(row.lost_time_incident_count),
    lostDays: Number(row.lost_days),
    incidentFrequencyRate: row.incident_frequency_rate,
    severityRate: row.severity_rate,
    createdAt: row.created_at,
  };
}

/**
 * A `DATE` column arrives as a JS `Date` at local midnight from node-postgres.
 * Reading it back through the local components (the pattern the Core HSE repo
 * uses) avoids shifting the day for a negative UTC offset.
 */
function toDateString(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.slice(0, 10);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}