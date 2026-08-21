import type { Pool, QueryResultRow } from "pg";
import type {
  CompleteFollowUpInput,
  CreateFollowUpInput,
  CreateHseRecordInput,
  HseFollowUp,
  HsePersonInvolved,
  HseRecord,
  HseRecordListFilter,
  HseRecordType,
  HseRepository,
  UpdateHseRecordInput,
} from "../domain/hse.entity.js";

/**
 * HSE Core persistence (Phase 7, HSE-CORE-001…010).
 *
 * Key implementation notes:
 *
 * - **No hard delete.** Safety records are never deleted by the application
 *   (prompt §30). No DELETE statement appears here.
 * - **No status column.** `workflow_instance_id` is the only lifecycle link.
 *   Lifecycle state is read from the Workflow Engine, not this repository.
 * - **Date columns.** `due_date` is stored as a `DATE` and returned as a
 *   JavaScript `Date` at local midnight by node-postgres. We convert via the
 *   local component pattern (same as Workforce/Finance) to avoid timezone
 *   shift for negative UTC offsets.
 * - **Dynamic filter pattern.** Reuses the `add()` helper from Finance/Asset
 *   to accumulate WHERE clauses and bound parameters without string injection.
 * - **Cross-domain exists checks** are plain `SELECT 1` queries — no
 *   domain-internal types imported.
 */
export class PgHseRepository implements HseRepository {
  constructor(private readonly pool: Pool) {}

  // ===================================================================
  // HSE records (HSE-CORE-001/002/008)
  // ===================================================================

  async createRecord(input: CreateHseRecordInput): Promise<HseRecord> {
    const r = await this.pool.query(
      `INSERT INTO hse_records
         (tenant_id, record_number, record_type, category_code, severity_code,
          occurred_at, title, summary, description, immediate_action,
          organization_unit_id, project_id, site_id, location_detail,
          reported_by_user_id, responsible_user_id, responsible_org_unit_id,
          created_by_user_id, updated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)
       RETURNING *`,
      [
        input.tenantId,
        input.recordNumber,
        input.recordType,
        input.categoryCode,
        input.severityCode,
        input.occurredAt,
        input.title,
        input.summary,
        input.description,
        input.immediateAction,
        input.organizationUnitId,
        input.projectId,
        input.siteId,
        input.locationDetail,
        input.reportedByUserId,
        input.responsibleUserId,
        input.responsibleOrgUnitId,
        input.createdBy,
      ],
    );
    return toRecord(r.rows[0]);
  }

  async findRecordById(id: string): Promise<HseRecord | null> {
    const r = await this.pool.query(`SELECT * FROM hse_records WHERE id = $1`, [id]);
    return r.rows[0] ? toRecord(r.rows[0]) : null;
  }

  async findRecordByNumber(tenantId: string, recordNumber: string): Promise<HseRecord | null> {
    const r = await this.pool.query(
      `SELECT * FROM hse_records WHERE tenant_id = $1 AND record_number = $2`,
      [tenantId, recordNumber],
    );
    return r.rows[0] ? toRecord(r.rows[0]) : null;
  }

  async listRecords(
    tenantId: string,
    filter: HseRecordListFilter,
    orgUnitIds: string[] | null,
  ): Promise<HseRecord[]> {
    const conditions: string[] = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];
    const add = (sql: (i: number) => string, value: unknown) => {
      params.push(value);
      conditions.push(sql(params.length));
    };

    if (filter.recordType) add((i) => `record_type = $${i}`, filter.recordType);
    if (filter.categoryCode) add((i) => `category_code = $${i}`, filter.categoryCode);
    if (filter.severityCode) add((i) => `severity_code = $${i}`, filter.severityCode);
    if (filter.organizationUnitId)
      add((i) => `organization_unit_id = $${i}`, filter.organizationUnitId);
    if (filter.projectId) add((i) => `project_id = $${i}`, filter.projectId);
    if (filter.siteId) add((i) => `site_id = $${i}`, filter.siteId);
    if (filter.reportedByUserId)
      add((i) => `reported_by_user_id = $${i}`, filter.reportedByUserId);
    if (filter.responsibleUserId)
      add((i) => `responsible_user_id = $${i}`, filter.responsibleUserId);
    if (filter.occurredFrom)
      add((i) => `occurred_at >= $${i}::timestamptz`, filter.occurredFrom);
    if (filter.occurredTo) add((i) => `occurred_at <= $${i}::timestamptz`, filter.occurredTo);
    if (filter.search) {
      add(
        (i) => `(title ILIKE $${i} OR summary ILIKE $${i} OR record_number ILIKE $${i})`,
        `%${filter.search}%`,
      );
    }

    // Data Scope: scoped actors see only their org units (including records
    // with no org unit — those are excluded from scoped views intentionally:
    // if a record has no org unit it is unanchored and only tenant-wide actors
    // should see it, matching `requireHseScope` in the service).
    if (orgUnitIds !== null) {
      add(
        (i) => `organization_unit_id = ANY($${i}::uuid[])`,
        orgUnitIds,
      );
    }

    const r = await this.pool.query(
      `SELECT * FROM hse_records
        WHERE ${conditions.join(" AND ")}
        ORDER BY occurred_at DESC, created_at DESC`,
      params,
    );
    return r.rows.map(toRecord);
  }

  async updateRecord(id: string, input: UpdateHseRecordInput): Promise<HseRecord | null> {
    // Only update fields explicitly provided in the input (partial update).
    // Uses COALESCE for scalars and a boolean flag pattern for nullable fields.
    const r = await this.pool.query(
      `UPDATE hse_records
          SET category_code           = CASE WHEN $2::boolean THEN $3      ELSE category_code           END,
              severity_code           = CASE WHEN $4::boolean THEN $5      ELSE severity_code           END,
              occurred_at             = CASE WHEN $6::boolean THEN $7::timestamptz ELSE occurred_at     END,
              title                   = COALESCE($8, title),
              summary                 = CASE WHEN $9::boolean THEN $10     ELSE summary                 END,
              description             = CASE WHEN $11::boolean THEN $12    ELSE description             END,
              immediate_action        = CASE WHEN $13::boolean THEN $14    ELSE immediate_action        END,
              organization_unit_id    = CASE WHEN $15::boolean THEN $16::uuid ELSE organization_unit_id END,
              project_id              = CASE WHEN $17::boolean THEN $18::uuid ELSE project_id           END,
              site_id                 = CASE WHEN $19::boolean THEN $20::uuid ELSE site_id              END,
              location_detail         = CASE WHEN $21::boolean THEN $22    ELSE location_detail         END,
              responsible_user_id     = CASE WHEN $23::boolean THEN $24::uuid ELSE responsible_user_id  END,
              responsible_org_unit_id = CASE WHEN $25::boolean THEN $26::uuid ELSE responsible_org_unit_id END,
              updated_by_user_id      = $27,
              updated_at              = now()
        WHERE id = $1
        RETURNING *`,
      [
        id,
        // category_code
        input.categoryCode !== undefined,
        input.categoryCode ?? null,
        // severity_code
        input.severityCode !== undefined,
        input.severityCode ?? null,
        // occurred_at
        input.occurredAt !== undefined,
        input.occurredAt ?? null,
        // title (COALESCE — only set if provided)
        input.title ?? null,
        // summary
        input.summary !== undefined,
        input.summary ?? null,
        // description
        input.description !== undefined,
        input.description ?? null,
        // immediate_action
        input.immediateAction !== undefined,
        input.immediateAction ?? null,
        // organization_unit_id
        input.organizationUnitId !== undefined,
        input.organizationUnitId ?? null,
        // project_id
        input.projectId !== undefined,
        input.projectId ?? null,
        // site_id
        input.siteId !== undefined,
        input.siteId ?? null,
        // location_detail
        input.locationDetail !== undefined,
        input.locationDetail ?? null,
        // responsible_user_id
        input.responsibleUserId !== undefined,
        input.responsibleUserId ?? null,
        // responsible_org_unit_id
        input.responsibleOrgUnitId !== undefined,
        input.responsibleOrgUnitId ?? null,
        // updated_by
        input.updatedBy ?? null,
      ],
    );
    return r.rows[0] ? toRecord(r.rows[0]) : null;
  }

  async setRecordWorkflowInstance(id: string, workflowInstanceId: string): Promise<void> {
    await this.pool.query(
      `UPDATE hse_records SET workflow_instance_id = $2, updated_at = now() WHERE id = $1`,
      [id, workflowInstanceId],
    );
  }

  // ===================================================================
  // Persons involved (HSE-CORE-004)
  // ===================================================================

  async addPersonInvolved(
    hseRecordId: string,
    input: { employeeId: string | null; personName: string | null; personRole: string | null },
  ): Promise<HsePersonInvolved> {
    const r = await this.pool.query(
      `INSERT INTO hse_persons_involved (hse_record_id, employee_id, person_name, person_role)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [hseRecordId, input.employeeId, input.personName, input.personRole],
    );
    return toPerson(r.rows[0]);
  }

  async listPersonsInvolved(hseRecordId: string): Promise<HsePersonInvolved[]> {
    const r = await this.pool.query(
      `SELECT * FROM hse_persons_involved WHERE hse_record_id = $1 ORDER BY created_at`,
      [hseRecordId],
    );
    return r.rows.map(toPerson);
  }

  async removePersonInvolved(id: string): Promise<void> {
    // Note: this is the only delete surface. `hse_persons_involved` rows do not
    // carry safety-critical history — they are metadata entries on the record.
    // The parent record itself is never deleted.
    await this.pool.query(`DELETE FROM hse_persons_involved WHERE id = $1`, [id]);
  }

  // ===================================================================
  // Follow-ups (HSE-CORE-007)
  // ===================================================================

  async createFollowUp(input: CreateFollowUpInput): Promise<HseFollowUp> {
    const r = await this.pool.query(
      `INSERT INTO hse_follow_ups
         (tenant_id, hse_record_id, title, description,
          assigned_to_user_id, assigned_to_org_unit_id, due_date,
          created_by_user_id, updated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$8)
       RETURNING *`,
      [
        input.tenantId,
        input.hseRecordId,
        input.title,
        input.description,
        input.assignedToUserId,
        input.assignedToOrgUnitId,
        input.dueDate,
        input.createdBy,
      ],
    );
    return toFollowUp(r.rows[0]);
  }

  async findFollowUpById(id: string): Promise<HseFollowUp | null> {
    const r = await this.pool.query(`SELECT * FROM hse_follow_ups WHERE id = $1`, [id]);
    return r.rows[0] ? toFollowUp(r.rows[0]) : null;
  }

  async listFollowUps(hseRecordId: string): Promise<HseFollowUp[]> {
    const r = await this.pool.query(
      `SELECT * FROM hse_follow_ups WHERE hse_record_id = $1 ORDER BY due_date ASC NULLS LAST, created_at`,
      [hseRecordId],
    );
    return r.rows.map(toFollowUp);
  }

  async completeFollowUp(id: string, input: CompleteFollowUpInput): Promise<HseFollowUp | null> {
    // Idempotent guard is enforced in the service before calling here.
    // This statement marks the follow-up as completed. If already completed
    // (race condition), the WHERE clause returns no rows and we return null.
    const r = await this.pool.query(
      `UPDATE hse_follow_ups
          SET completed_at         = now(),
              completed_by_user_id = $2,
              completion_notes     = $3,
              updated_by_user_id   = $2,
              updated_at           = now()
        WHERE id = $1 AND completed_at IS NULL
        RETURNING *`,
      [id, input.completedBy, input.completionNotes],
    );
    return r.rows[0] ? toFollowUp(r.rows[0]) : null;
  }

  // ===================================================================
  // Cross-domain existence checks (clean reference ports)
  // ===================================================================

  async organizationUnitExists(tenantId: string, id: string): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT 1 FROM organization_units WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async projectExists(tenantId: string, id: string): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT 1 FROM projects WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async siteExists(tenantId: string, id: string): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT 1 FROM sites WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async userExists(tenantId: string, id: string): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** Clean port — checks existence in `employees` without importing any
   * Workforce domain types. Same pattern as Asset custodian reference. */
  async employeeExists(tenantId: string, employeeId: string): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT 1 FROM employees WHERE id = $1 AND tenant_id = $2`,
      [employeeId, tenantId],
    );
    return (r.rowCount ?? 0) > 0;
  }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

/** pg returns `date` columns as a JS Date at local midnight. We read local
 * components so negative UTC offsets do not shift the date (same as Workforce
 * and Finance). */
function toDateString(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (value == null) return "";
  return String(value).slice(0, 10);
}

function toRecord(row: QueryResultRow): HseRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    recordNumber: row.record_number,
    recordType: row.record_type as HseRecordType,
    categoryCode: row.category_code ?? null,
    severityCode: row.severity_code ?? null,
    occurredAt: row.occurred_at,
    reportedAt: row.reported_at,
    title: row.title,
    summary: row.summary ?? null,
    description: row.description ?? null,
    immediateAction: row.immediate_action ?? null,
    organizationUnitId: row.organization_unit_id ?? null,
    projectId: row.project_id ?? null,
    siteId: row.site_id ?? null,
    locationDetail: row.location_detail ?? null,
    reportedByUserId: row.reported_by_user_id,
    responsibleUserId: row.responsible_user_id ?? null,
    responsibleOrgUnitId: row.responsible_org_unit_id ?? null,
    workflowInstanceId: row.workflow_instance_id ?? null,
    createdByUserId: row.created_by_user_id ?? null,
    updatedByUserId: row.updated_by_user_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPerson(row: QueryResultRow): HsePersonInvolved {
  return {
    id: row.id,
    hseRecordId: row.hse_record_id,
    employeeId: row.employee_id ?? null,
    personName: row.person_name ?? null,
    personRole: row.person_role ?? null,
    createdAt: row.created_at,
  };
}

function toFollowUp(row: QueryResultRow): HseFollowUp {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    hseRecordId: row.hse_record_id,
    title: row.title,
    description: row.description ?? null,
    assignedToUserId: row.assigned_to_user_id ?? null,
    assignedToOrgUnitId: row.assigned_to_org_unit_id ?? null,
    dueDate: row.due_date ? toDateString(row.due_date) : null,
    completedAt: row.completed_at ?? null,
    completedByUserId: row.completed_by_user_id ?? null,
    completionNotes: row.completion_notes ?? null,
    createdByUserId: row.created_by_user_id ?? null,
    updatedByUserId: row.updated_by_user_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
