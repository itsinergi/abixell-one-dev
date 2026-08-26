import type { Pool } from "pg";
import type { WorkweekWindow } from "../../../domain/service-quality/business-calendar.js";
import type {
  AutomationProposal,
  AutomationRule,
  AutomationTriggerEvent,
  BusinessCalendar,
  CalendarHoliday,
  CapaAction,
  CapaEffectivenessRow,
  CapaStatus,
  CapaVerdict,
  CreateAutomationProposalInput,
  CreateAutomationRuleInput,
  CreateBusinessCalendarInput,
  CreateCapaActionInput,
  CreateRcaFindingInput,
  CreateRecurrenceRuleInput,
  CreateRootCauseCategoryInput,
  CreateSlaPolicyInput,
  CreateSlaRuleInput,
  CreateSlaTargetInput,
  ProposalStatus,
  RcaFinding,
  RecurrenceCluster,
  RecurrenceRule,
  RootCauseCategory,
  ServiceQualityLifecycleEvent,
  ServiceQualityRepository,
  SlaMatchContext,
  SlaPerformanceRow,
  SlaPolicy,
  SlaRule,
  SlaTarget,
} from "../../../domain/service-quality/service-quality.entity.js";

function optionalNum(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function count(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

/** DATE columns are read as plain YYYY-MM-DD so a business date never drifts
 * through a timezone conversion. */
function dateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCalendar(row: any): BusinessCalendar {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    description: row.description,
    timeZone: row.time_zone,
    isContinuous: row.is_continuous,
    isDefault: row.is_default,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPolicy(row: any): SlaPolicy {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    description: row.description,
    calendarId: row.calendar_id,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRule(row: any): SlaRule {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    policyId: row.policy_id,
    code: row.code,
    customerId: row.customer_id,
    contractId: row.contract_id,
    severityCode: row.severity_code,
    categoryCode: row.category_code,
    responseMinutes: optionalNum(row.response_minutes),
    resolutionMinutes: optionalNum(row.resolution_minutes),
    priority: Number(row.priority),
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapTarget(row: any): SlaTarget {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    complaintId: row.complaint_id,
    policyId: row.policy_id,
    ruleId: row.rule_id,
    calendarId: row.calendar_id,
    policyCodeSnapshot: row.policy_code_snapshot,
    ruleCodeSnapshot: row.rule_code_snapshot,
    calendarCodeSnapshot: row.calendar_code_snapshot,
    timeZoneSnapshot: row.time_zone_snapshot,
    matchedDimensions: row.matched_dimensions ?? {},
    startedAt: row.started_at,
    responseMinutes: optionalNum(row.response_minutes),
    resolutionMinutes: optionalNum(row.resolution_minutes),
    responseDueAt: row.response_due_at,
    resolutionDueAt: row.resolution_due_at,
    firstResponseAt: row.first_response_at,
    resolvedAt: row.resolved_at,
    responseBreached: row.response_breached,
    resolutionBreached: row.resolution_breached,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRootCauseCategory(row: any): RootCauseCategory {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    description: row.description,
    parentId: row.parent_id,
    sortOrder: Number(row.sort_order),
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRcaFinding(row: any): RcaFinding {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    complaintId: row.complaint_id,
    rootCauseCategoryId: row.root_cause_category_id,
    analysisMethodCode: row.analysis_method_code,
    statement: row.statement,
    evidenceSummary: row.evidence_summary,
    isPrimary: row.is_primary,
    identifiedBy: row.identified_by,
    identifiedAt: row.identified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCapa(row: any): CapaAction {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    complaintId: row.complaint_id,
    rcaFindingId: row.rca_finding_id,
    actionNumber: row.action_number,
    actionType: row.action_type,
    title: row.title,
    description: row.description,
    ownerUserId: row.owner_user_id,
    dueDate: dateOnly(row.due_date),
    status: row.status,
    completedAt: row.completed_at,
    completionNote: row.completion_note,
    effectivenessVerdict: row.effectiveness_verdict,
    effectivenessNote: row.effectiveness_note,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
    workflowInstanceId: row.workflow_instance_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRecurrenceRule(row: any): RecurrenceRule {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    description: row.description,
    groupBy: row.group_by,
    windowDays: Number(row.window_days),
    minimumOccurrences: Number(row.minimum_occurrences),
    customerId: row.customer_id,
    severityCode: row.severity_code,
    categoryCode: row.category_code,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapAutomationRule(row: any): AutomationRule {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    description: row.description,
    triggerEvent: row.trigger_event,
    scoreThreshold: optionalNum(row.score_threshold),
    proposedAction: row.proposed_action,
    actionParameters: row.action_parameters ?? {},
    requiresApproval: row.requires_approval,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapProposal(row: any): AutomationProposal {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ruleId: row.rule_id,
    idempotencyKey: row.idempotency_key,
    sourceEntityType: row.source_entity_type,
    sourceEntityId: row.source_entity_id,
    targetEntityType: row.target_entity_type,
    targetEntityId: row.target_entity_id,
    proposedAction: row.proposed_action,
    actionParameters: row.action_parameters ?? {},
    rationale: row.rationale,
    status: row.status,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    appliedAt: row.applied_at,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Wave A1 — Service Quality Advanced persistence. Every statement filters by
 * `tenant_id` directly (each table carries its own), and every scope-aware
 * query takes the actor's authorized customer ids as a bound array so Data
 * Scope is enforced by the database rather than by post-filtering.
 */
export class PgServiceQualityRepository implements ServiceQualityRepository {
  constructor(private readonly pool: Pool) {}

  // --- SQ-ADV-001: calendars ---------------------------------------------

  async createCalendar(
    input: CreateBusinessCalendarInput,
    createdBy: string | null,
  ): Promise<BusinessCalendar> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // A default calendar is unique per tenant (partial unique index), so
      // the previous default is stood down inside the same transaction.
      if (input.isDefault) {
        await client.query(
          `UPDATE service_business_calendars SET is_default = false, updated_at = now()
            WHERE tenant_id = $1 AND is_default AND deleted_at IS NULL`,
          [input.tenantId],
        );
      }
      const { rows } = await client.query(
        `INSERT INTO service_business_calendars
           (tenant_id, code, name, description, time_zone, is_continuous, is_default, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         RETURNING *`,
        [
          input.tenantId,
          input.code,
          input.name,
          input.description ?? null,
          input.timeZone,
          input.isContinuous ?? false,
          input.isDefault ?? false,
          createdBy,
        ],
      );
      const calendar = mapCalendar(rows[0]);
      for (const window of input.windows) {
        await client.query(
          `INSERT INTO service_calendar_workweek
             (tenant_id, calendar_id, day_of_week, start_minute, end_minute)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            input.tenantId,
            calendar.id,
            window.dayOfWeek,
            window.startMinute,
            window.endMinute,
          ],
        );
      }
      await client.query("COMMIT");
      return calendar;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findCalendarById(tenantId: string, id: string): Promise<BusinessCalendar | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM service_business_calendars
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    return rows[0] ? mapCalendar(rows[0]) : null;
  }

  async findCalendarByCode(tenantId: string, code: string): Promise<BusinessCalendar | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM service_business_calendars
        WHERE tenant_id = $1 AND code = $2 AND deleted_at IS NULL`,
      [tenantId, code],
    );
    return rows[0] ? mapCalendar(rows[0]) : null;
  }

  async listCalendars(tenantId: string): Promise<BusinessCalendar[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM service_business_calendars
        WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY code`,
      [tenantId],
    );
    return rows.map(mapCalendar);
  }

  async listCalendarWindows(tenantId: string, calendarId: string): Promise<WorkweekWindow[]> {
    const { rows } = await this.pool.query(
      `SELECT day_of_week, start_minute, end_minute
         FROM service_calendar_workweek
        WHERE tenant_id = $1 AND calendar_id = $2
        ORDER BY day_of_week, start_minute`,
      [tenantId, calendarId],
    );
    return rows.map((row) => ({
      dayOfWeek: Number(row.day_of_week),
      startMinute: Number(row.start_minute),
      endMinute: Number(row.end_minute),
    }));
  }

  async addHoliday(
    tenantId: string,
    calendarId: string,
    holidayDate: string,
    name: string,
    createdBy: string | null,
  ): Promise<CalendarHoliday> {
    const { rows } = await this.pool.query(
      `INSERT INTO service_calendar_holidays (tenant_id, calendar_id, holiday_date, name, created_by)
       VALUES ($1, $2, $3::date, $4, $5)
       RETURNING id, calendar_id, holiday_date, name`,
      [tenantId, calendarId, holidayDate, name, createdBy],
    );
    return {
      id: rows[0].id,
      calendarId: rows[0].calendar_id,
      holidayDate: dateOnly(rows[0].holiday_date) ?? holidayDate,
      name: rows[0].name,
    };
  }

  async listHolidays(tenantId: string, calendarId: string): Promise<CalendarHoliday[]> {
    const { rows } = await this.pool.query(
      `SELECT id, calendar_id, holiday_date, name
         FROM service_calendar_holidays
        WHERE tenant_id = $1 AND calendar_id = $2
        ORDER BY holiday_date`,
      [tenantId, calendarId],
    );
    return rows.map((row) => ({
      id: row.id,
      calendarId: row.calendar_id,
      holidayDate: dateOnly(row.holiday_date) ?? "",
      name: row.name,
    }));
  }

  // --- SQ-ADV-001: policies and rules -------------------------------------

  async createSlaPolicy(input: CreateSlaPolicyInput, createdBy: string | null): Promise<SlaPolicy> {
    const { rows } = await this.pool.query(
      `INSERT INTO service_sla_policies (tenant_id, code, name, description, calendar_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       RETURNING *`,
      [input.tenantId, input.code, input.name, input.description ?? null, input.calendarId, createdBy],
    );
    return mapPolicy(rows[0]);
  }

  async findSlaPolicyById(tenantId: string, id: string): Promise<SlaPolicy | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM service_sla_policies WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    return rows[0] ? mapPolicy(rows[0]) : null;
  }

  async listSlaPolicies(tenantId: string): Promise<SlaPolicy[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM service_sla_policies WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY code`,
      [tenantId],
    );
    return rows.map(mapPolicy);
  }

  async createSlaRule(input: CreateSlaRuleInput, createdBy: string | null): Promise<SlaRule> {
    const { rows } = await this.pool.query(
      `INSERT INTO service_sla_rules
         (tenant_id, policy_id, code, customer_id, contract_id, severity_code, category_code,
          response_minutes, resolution_minutes, priority, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
       RETURNING *`,
      [
        input.tenantId,
        input.policyId,
        input.code,
        input.customerId ?? null,
        input.contractId ?? null,
        input.severityCode ?? null,
        input.categoryCode ?? null,
        input.responseMinutes ?? null,
        input.resolutionMinutes ?? null,
        input.priority ?? 0,
        createdBy,
      ],
    );
    return mapRule(rows[0]);
  }

  async listSlaRules(tenantId: string, policyId: string): Promise<SlaRule[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM service_sla_rules
        WHERE tenant_id = $1 AND policy_id = $2 AND deleted_at IS NULL
        ORDER BY priority DESC, code`,
      [tenantId, policyId],
    );
    return rows.map(mapRule);
  }

  async listCandidateSlaRules(
    tenantId: string,
    context: SlaMatchContext,
  ): Promise<SlaRule[]> {
    // A NULL dimension column means "any" and therefore always matches; a
    // constrained column must equal the complaint's own value. Ranking of the
    // survivors happens in `selectSlaRule` so the precedence is one readable,
    // directly tested function.
    const { rows } = await this.pool.query(
      `SELECT r.*
         FROM service_sla_rules r
         JOIN service_sla_policies p
           ON p.id = r.policy_id AND p.tenant_id = r.tenant_id
          AND p.is_active AND p.deleted_at IS NULL
         JOIN service_business_calendars bc
           ON bc.id = p.calendar_id AND bc.tenant_id = p.tenant_id
          AND bc.is_active AND bc.deleted_at IS NULL
        WHERE r.tenant_id = $1
          AND r.is_active
          AND r.deleted_at IS NULL
          AND (r.customer_id   IS NULL OR r.customer_id   = $2::uuid)
          AND (r.contract_id   IS NULL OR r.contract_id   = $3::uuid)
          AND (r.severity_code IS NULL OR r.severity_code = $4)
          AND (r.category_code IS NULL OR r.category_code = $5)`,
      [
        tenantId,
        context.customerId,
        context.contractId,
        context.severityCode,
        context.categoryCode,
      ],
    );
    return rows.map(mapRule);
  }

  async createSlaTargetIfAbsent(
    input: CreateSlaTargetInput,
    createdBy: string | null,
  ): Promise<{ target: SlaTarget; created: boolean }> {
    const inserted = await this.pool.query(
      `INSERT INTO complaint_sla_targets
         (tenant_id, complaint_id, policy_id, rule_id, calendar_id,
          policy_code_snapshot, rule_code_snapshot, calendar_code_snapshot, time_zone_snapshot,
          matched_dimensions, started_at, response_minutes, resolution_minutes,
          response_due_at, resolution_due_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (complaint_id) DO NOTHING
       RETURNING *`,
      [
        input.tenantId,
        input.complaintId,
        input.policyId,
        input.ruleId,
        input.calendarId,
        input.policyCodeSnapshot,
        input.ruleCodeSnapshot,
        input.calendarCodeSnapshot,
        input.timeZoneSnapshot,
        JSON.stringify(input.matchedDimensions),
        input.startedAt,
        input.responseMinutes,
        input.resolutionMinutes,
        input.responseDueAt,
        input.resolutionDueAt,
        createdBy,
      ],
    );
    if (inserted.rows[0]) {
      return { target: mapTarget(inserted.rows[0]), created: true };
    }
    const existing = await this.findSlaTargetByComplaint(input.tenantId, input.complaintId);
    if (!existing) {
      throw new Error("SLA target conflict did not resolve within the Tenant");
    }
    return { target: existing, created: false };
  }

  async findSlaTargetByComplaint(
    tenantId: string,
    complaintId: string,
  ): Promise<SlaTarget | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM complaint_sla_targets WHERE tenant_id = $1 AND complaint_id = $2`,
      [tenantId, complaintId],
    );
    return rows[0] ? mapTarget(rows[0]) : null;
  }

  async markFirstResponse(
    tenantId: string,
    complaintId: string,
    at: Date,
    breached: boolean,
  ): Promise<SlaTarget> {
    // COALESCE keeps the FIRST response first: a later reply must not
    // overwrite the timestamp the commitment was actually measured against.
    const { rows } = await this.pool.query(
      `UPDATE complaint_sla_targets
          SET first_response_at = COALESCE(first_response_at, $3),
              response_breached = CASE WHEN first_response_at IS NULL THEN $4 ELSE response_breached END,
              updated_at = now()
        WHERE tenant_id = $1 AND complaint_id = $2
        RETURNING *`,
      [tenantId, complaintId, at, breached],
    );
    if (!rows[0]) {
      throw new Error("SLA target disappeared while recording first response");
    }
    return mapTarget(rows[0]);
  }

  async markResolved(
    tenantId: string,
    complaintId: string,
    at: Date,
    breached: boolean,
  ): Promise<SlaTarget> {
    const { rows } = await this.pool.query(
      `UPDATE complaint_sla_targets
          SET resolved_at = COALESCE(resolved_at, $3),
              resolution_breached = CASE WHEN resolved_at IS NULL THEN $4 ELSE resolution_breached END,
              updated_at = now()
        WHERE tenant_id = $1 AND complaint_id = $2
        RETURNING *`,
      [tenantId, complaintId, at, breached],
    );
    if (!rows[0]) {
      throw new Error("SLA target disappeared while recording resolution");
    }
    return mapTarget(rows[0]);
  }

  async summariseSlaPerformance(
    tenantId: string,
    customerIds: string[],
    now: Date,
  ): Promise<SlaPerformanceRow[]> {
    const { rows } = await this.pool.query(
      `SELECT c.severity                                         AS severity_code,
              COUNT(*)                                           AS total_with_target,
              COUNT(*) FILTER (
                WHERE t.response_breached
                   OR (t.first_response_at IS NULL
                       AND t.response_due_at IS NOT NULL
                       AND t.response_due_at < $3)
              )                                                  AS response_breached,
              COUNT(*) FILTER (WHERE t.resolution_breached)      AS resolution_breached,
              COUNT(*) FILTER (WHERE t.resolved_at IS NULL
                                 AND t.resolution_due_at IS NOT NULL
                                 AND t.resolution_due_at < $3)    AS open_past_due
         FROM complaint_sla_targets t
         JOIN complaints c ON c.id = t.complaint_id AND c.tenant_id = t.tenant_id
        WHERE t.tenant_id = $1
          AND c.customer_id = ANY($2::uuid[])
          AND c.deleted_at IS NULL
        GROUP BY c.severity
        ORDER BY c.severity`,
      [tenantId, customerIds, now],
    );
    return rows.map((row) => ({
      severityCode: row.severity_code,
      totalWithTarget: count(row.total_with_target),
      responseBreached: count(row.response_breached),
      resolutionBreached: count(row.resolution_breached),
      openPastDue: count(row.open_past_due),
    }));
  }

  async listPendingLifecycleEvents(
    tenantId: string,
    limit: number,
  ): Promise<ServiceQualityLifecycleEvent[]> {
    const boundedLimit = Math.max(1, Math.min(limit, 500));
    const { rows } = await this.pool.query(
      `SELECT de.id,
              de.tenant_id,
              de.event_type,
              de.entity_id,
              de.occurred_at,
              de.created_by
         FROM domain_events de
         LEFT JOIN service_quality_event_receipts receipt
           ON receipt.tenant_id = de.tenant_id
          AND receipt.domain_event_id = de.id
        WHERE de.tenant_id = $1
          AND de.entity_type = 'complaint'
          AND de.entity_id IS NOT NULL
          AND de.event_type IN (
            'complaint.submitted',
            'complaint.acknowledged',
            'complaint.customer_confirmed'
          )
          AND receipt.domain_event_id IS NULL
        ORDER BY de.occurred_at, de.id
        LIMIT $2`,
      [tenantId, boundedLimit],
    );
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      eventType: row.event_type,
      complaintId: row.entity_id,
      occurredAt: row.occurred_at,
      createdBy: row.created_by,
    }));
  }

  async recordLifecycleEventProcessed(
    tenantId: string,
    domainEventId: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO service_quality_event_receipts
         (tenant_id, domain_event_id)
       SELECT $1, de.id
         FROM domain_events de
        WHERE de.id = $2
          AND de.tenant_id = $1
          AND de.entity_type = 'complaint'
          AND de.event_type IN (
            'complaint.submitted',
            'complaint.acknowledged',
            'complaint.customer_confirmed'
          )
       ON CONFLICT (tenant_id, domain_event_id) DO NOTHING`,
      [tenantId, domainEventId],
    );
  }

  // --- SQ-ADV-002: RCA taxonomy and findings ------------------------------

  async createRootCauseCategory(
    input: CreateRootCauseCategoryInput,
    createdBy: string | null,
  ): Promise<RootCauseCategory> {
    const { rows } = await this.pool.query(
      `INSERT INTO service_root_cause_categories
         (tenant_id, code, name, description, parent_id, sort_order, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       RETURNING *`,
      [
        input.tenantId,
        input.code,
        input.name,
        input.description ?? null,
        input.parentId ?? null,
        input.sortOrder ?? 0,
        createdBy,
      ],
    );
    return mapRootCauseCategory(rows[0]);
  }

  async findRootCauseCategoryById(
    tenantId: string,
    id: string,
  ): Promise<RootCauseCategory | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM service_root_cause_categories
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    return rows[0] ? mapRootCauseCategory(rows[0]) : null;
  }

  async listRootCauseCategories(tenantId: string): Promise<RootCauseCategory[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM service_root_cause_categories
        WHERE tenant_id = $1 AND deleted_at IS NULL
        ORDER BY sort_order, code`,
      [tenantId],
    );
    return rows.map(mapRootCauseCategory);
  }

  async createRcaFinding(
    input: CreateRcaFindingInput,
    createdBy: string | null,
  ): Promise<RcaFinding> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (input.isPrimary) {
        await client.query(
          `UPDATE complaint_rca_findings
              SET is_primary = false, updated_by = $3, updated_at = now()
            WHERE tenant_id = $1 AND complaint_id = $2 AND is_primary AND deleted_at IS NULL`,
          [input.tenantId, input.complaintId, createdBy],
        );
      }
      const { rows } = await client.query(
        `INSERT INTO complaint_rca_findings
           (tenant_id, complaint_id, root_cause_category_id, analysis_method_code,
            statement, evidence_summary, is_primary, identified_by, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
         RETURNING *`,
        [
          input.tenantId,
          input.complaintId,
          input.rootCauseCategoryId,
          input.analysisMethodCode ?? null,
          input.statement,
          input.evidenceSummary ?? null,
          input.isPrimary,
          createdBy,
          createdBy,
        ],
      );
      await client.query("COMMIT");
      return mapRcaFinding(rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async findRcaFindingById(tenantId: string, id: string): Promise<RcaFinding | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM complaint_rca_findings
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    return rows[0] ? mapRcaFinding(rows[0]) : null;
  }

  async listRcaFindings(tenantId: string, complaintId: string): Promise<RcaFinding[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM complaint_rca_findings
        WHERE tenant_id = $1 AND complaint_id = $2 AND deleted_at IS NULL
        ORDER BY is_primary DESC, identified_at`,
      [tenantId, complaintId],
    );
    return rows.map(mapRcaFinding);
  }

  async clearPrimaryRcaFinding(
    tenantId: string,
    complaintId: string,
    updatedBy: string | null,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE complaint_rca_findings
          SET is_primary = false, updated_by = $3, updated_at = now()
        WHERE tenant_id = $1 AND complaint_id = $2 AND is_primary AND deleted_at IS NULL`,
      [tenantId, complaintId, updatedBy],
    );
  }

  // --- SQ-ADV-002: CAPA ---------------------------------------------------

  async createCapaAction(
    input: CreateCapaActionInput,
    createdBy: string | null,
  ): Promise<CapaAction> {
    const { rows } = await this.pool.query(
      `INSERT INTO complaint_capa_actions
         (tenant_id, complaint_id, rca_finding_id, action_number, action_type,
          title, description, owner_user_id, due_date, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $10)
       RETURNING *`,
      [
        input.tenantId,
        input.complaintId,
        input.rcaFindingId,
        input.actionNumber,
        input.actionType,
        input.title,
        input.description ?? null,
        input.ownerUserId ?? null,
        input.dueDate ?? null,
        createdBy,
      ],
    );
    return mapCapa(rows[0]);
  }

  async findCapaActionById(tenantId: string, id: string): Promise<CapaAction | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM complaint_capa_actions
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    return rows[0] ? mapCapa(rows[0]) : null;
  }

  async listCapaActions(tenantId: string, complaintId: string): Promise<CapaAction[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM complaint_capa_actions
        WHERE tenant_id = $1 AND complaint_id = $2 AND deleted_at IS NULL
        ORDER BY created_at`,
      [tenantId, complaintId],
    );
    return rows.map(mapCapa);
  }

  async listCapaActionsByCustomers(
    tenantId: string,
    customerIds: string[],
  ): Promise<CapaAction[]> {
    const { rows } = await this.pool.query(
      `SELECT a.*
         FROM complaint_capa_actions a
         JOIN complaints c ON c.id = a.complaint_id AND c.tenant_id = a.tenant_id
        WHERE a.tenant_id = $1
          AND c.customer_id = ANY($2::uuid[])
          AND a.deleted_at IS NULL
        ORDER BY a.created_at DESC`,
      [tenantId, customerIds],
    );
    return rows.map(mapCapa);
  }

  async updateCapaStatus(
    tenantId: string,
    id: string,
    status: CapaStatus,
    updatedBy: string | null,
    extra?: { completedAt?: Date | null; completionNote?: string | null },
  ): Promise<CapaAction> {
    const { rows } = await this.pool.query(
      `UPDATE complaint_capa_actions
          SET status = $3,
              completed_at = COALESCE($4, completed_at),
              completion_note = COALESCE($5, completion_note),
              updated_by = $6,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        RETURNING *`,
      [tenantId, id, status, extra?.completedAt ?? null, extra?.completionNote ?? null, updatedBy],
    );
    return mapCapa(rows[0]);
  }

  async recordCapaVerification(
    tenantId: string,
    id: string,
    verdict: CapaVerdict,
    note: string | null,
    verifiedBy: string,
  ): Promise<CapaAction> {
    // The verdict drives the status directly: an action verified ineffective
    // must not be able to sit in `verified`.
    const { rows } = await this.pool.query(
      `UPDATE complaint_capa_actions
          SET effectiveness_verdict = $3,
              effectiveness_note = $4,
              verified_by = $5,
              verified_at = now(),
              status = CASE WHEN $3 = 'effective' THEN 'verified' ELSE 'ineffective' END,
              updated_by = $5,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        RETURNING *`,
      [tenantId, id, verdict, note, verifiedBy],
    );
    return mapCapa(rows[0]);
  }

  async setCapaWorkflowInstance(
    tenantId: string,
    id: string,
    workflowInstanceId: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE complaint_capa_actions
          SET workflow_instance_id = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, workflowInstanceId],
    );
  }

  async summariseCapaEffectiveness(
    tenantId: string,
    customerIds: string[],
  ): Promise<CapaEffectivenessRow[]> {
    const { rows } = await this.pool.query(
      `SELECT a.status,
              a.action_type,
              COUNT(*)                                                          AS action_count,
              COUNT(*) FILTER (WHERE a.effectiveness_verdict = 'effective')     AS effective_count,
              COUNT(*) FILTER (WHERE a.effectiveness_verdict = 'ineffective')   AS ineffective_count
         FROM complaint_capa_actions a
         JOIN complaints c ON c.id = a.complaint_id AND c.tenant_id = a.tenant_id
        WHERE a.tenant_id = $1
          AND c.customer_id = ANY($2::uuid[])
          AND a.deleted_at IS NULL
        GROUP BY a.status, a.action_type
        ORDER BY a.status, a.action_type`,
      [tenantId, customerIds],
    );
    return rows.map((row) => ({
      status: row.status,
      actionType: row.action_type,
      actionCount: count(row.action_count),
      effectiveCount: count(row.effective_count),
      ineffectiveCount: count(row.ineffective_count),
    }));
  }

  // --- SQ-ADV-003: recurrence --------------------------------------------

  async createRecurrenceRule(
    input: CreateRecurrenceRuleInput,
    createdBy: string | null,
  ): Promise<RecurrenceRule> {
    const { rows } = await this.pool.query(
      `INSERT INTO service_recurrence_rules
         (tenant_id, code, name, description, group_by, window_days, minimum_occurrences,
          customer_id, severity_code, category_code, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
       RETURNING *`,
      [
        input.tenantId,
        input.code,
        input.name,
        input.description ?? null,
        input.groupBy,
        input.windowDays,
        input.minimumOccurrences,
        input.customerId ?? null,
        input.severityCode ?? null,
        input.categoryCode ?? null,
        createdBy,
      ],
    );
    return mapRecurrenceRule(rows[0]);
  }

  async findRecurrenceRuleById(tenantId: string, id: string): Promise<RecurrenceRule | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM service_recurrence_rules
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    return rows[0] ? mapRecurrenceRule(rows[0]) : null;
  }

  async listRecurrenceRules(tenantId: string): Promise<RecurrenceRule[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM service_recurrence_rules
        WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY code`,
      [tenantId],
    );
    return rows.map(mapRecurrenceRule);
  }

  async detectRecurrence(
    tenantId: string,
    rule: RecurrenceRule,
    customerIds: string[],
    windowStart: Date,
    windowEnd: Date,
  ): Promise<RecurrenceCluster[]> {
    // `group_by` is a closed vocabulary constrained by a CHECK in the schema,
    // and it selects one of these fixed, pre-written expressions. No part of
    // the query is assembled from Tenant text — there is no expression
    // language and no dynamic SQL surface here.
    const grouping: Record<
      RecurrenceRule["groupBy"],
      { key: string; label: string; join: string }
    > = {
      category: { key: "c.category", label: "c.category", join: "" },
      severity: { key: "c.severity", label: "c.severity", join: "" },
      customer: {
        key: "c.customer_id::text",
        label: "cust.name",
        join: "LEFT JOIN customers cust ON cust.id = c.customer_id AND cust.tenant_id = c.tenant_id AND cust.deleted_at IS NULL",
      },
      site: {
        key: "c.site_id::text",
        label: "st.name",
        join: "LEFT JOIN sites st ON st.id = c.site_id AND st.tenant_id = c.tenant_id AND st.deleted_at IS NULL",
      },
      service: {
        key: "c.service_id::text",
        label: "sv.name",
        join: "LEFT JOIN services sv ON sv.id = c.service_id AND sv.tenant_id = c.tenant_id",
      },
      root_cause: {
        key: "rc.code",
        label: "rc.name",
        join: `LEFT JOIN complaint_rca_findings f
                 ON f.complaint_id = c.id AND f.tenant_id = c.tenant_id AND f.is_primary AND f.deleted_at IS NULL
               LEFT JOIN service_root_cause_categories rc
                 ON rc.id = f.root_cause_category_id AND rc.tenant_id = c.tenant_id AND rc.deleted_at IS NULL`,
      },
    };
    const g = grouping[rule.groupBy];

    const { rows } = await this.pool.query(
      `SELECT ${g.key}                    AS group_key,
              COALESCE(MAX(${g.label}), ${g.key}) AS group_label,
              COUNT(*)                    AS occurrences,
              MIN(c.submitted_at)         AS first_occurred_at,
              MAX(c.submitted_at)         AS last_occurred_at,
              ARRAY_AGG(c.id ORDER BY c.submitted_at ASC, c.id ASC) AS complaint_ids
         FROM complaints c
         ${g.join}
        WHERE c.tenant_id = $1
          AND c.customer_id = ANY($2::uuid[])
          AND c.deleted_at IS NULL
          AND c.submitted_at IS NOT NULL
          AND c.submitted_at >= $3
          AND c.submitted_at <= $4
          AND ($5::uuid IS NULL OR c.customer_id = $5::uuid)
          AND ($6::text IS NULL OR c.severity = $6)
          AND ($7::text IS NULL OR c.category = $7)
          AND ${g.key} IS NOT NULL
        GROUP BY ${g.key}
       HAVING COUNT(*) >= $8
        ORDER BY COUNT(*) DESC, ${g.key} ASC`,
      [
        tenantId,
        customerIds,
        windowStart,
        windowEnd,
        rule.customerId,
        rule.severityCode,
        rule.categoryCode,
        rule.minimumOccurrences,
      ],
    );

    return rows.map((row) => ({
      groupKey: row.group_key,
      groupLabel: row.group_label,
      occurrences: count(row.occurrences),
      firstOccurredAt: row.first_occurred_at,
      lastOccurredAt: row.last_occurred_at,
      complaintIds: row.complaint_ids ?? [],
    }));
  }

  // --- SQ-ADV-004: gated automation ---------------------------------------

  async createAutomationRule(
    input: CreateAutomationRuleInput,
    createdBy: string | null,
  ): Promise<AutomationRule> {
    // `requires_approval` is intentionally NOT a parameter: the column is
    // CHECK-pinned true and is left at its default, so no caller can request
    // an autonomous rule.
    const { rows } = await this.pool.query(
      `INSERT INTO service_feedback_automation_rules
         (tenant_id, code, name, description, trigger_event, score_threshold,
          proposed_action, action_parameters, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $9)
       RETURNING *`,
      [
        input.tenantId,
        input.code,
        input.name,
        input.description ?? null,
        input.triggerEvent,
        input.scoreThreshold ?? null,
        input.proposedAction,
        JSON.stringify(input.actionParameters ?? {}),
        createdBy,
      ],
    );
    return mapAutomationRule(rows[0]);
  }

  async findAutomationRuleById(tenantId: string, id: string): Promise<AutomationRule | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM service_feedback_automation_rules
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    return rows[0] ? mapAutomationRule(rows[0]) : null;
  }

  async listAutomationRules(tenantId: string): Promise<AutomationRule[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM service_feedback_automation_rules
        WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY code`,
      [tenantId],
    );
    return rows.map(mapAutomationRule);
  }

  async setAutomationRuleActive(
    tenantId: string,
    id: string,
    isActive: boolean,
    updatedBy: string | null,
  ): Promise<AutomationRule> {
    const { rows } = await this.pool.query(
      `UPDATE service_feedback_automation_rules
          SET is_active = $3, updated_by = $4, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        RETURNING *`,
      [tenantId, id, isActive, updatedBy],
    );
    return mapAutomationRule(rows[0]);
  }

  async listActiveAutomationRulesByTrigger(
    tenantId: string,
    triggerEvent: AutomationTriggerEvent,
  ): Promise<AutomationRule[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM service_feedback_automation_rules
        WHERE tenant_id = $1 AND trigger_event = $2 AND is_active AND deleted_at IS NULL
        ORDER BY code`,
      [tenantId, triggerEvent],
    );
    return rows.map(mapAutomationRule);
  }

  async createProposalIfAbsent(
    input: CreateAutomationProposalInput,
    createdBy: string | null,
  ): Promise<{ proposal: AutomationProposal; created: boolean }> {
    // ON CONFLICT DO NOTHING against the per-tenant idempotency index makes a
    // replayed source event a genuine no-op rather than a duplicate proposal.
    const inserted = await this.pool.query(
      `INSERT INTO service_feedback_automation_proposals
         (tenant_id, rule_id, idempotency_key, source_entity_type, source_entity_id,
          target_entity_type, target_entity_id, proposed_action, action_parameters,
          rationale, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $11)
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
       RETURNING *`,
      [
        input.tenantId,
        input.ruleId,
        input.idempotencyKey,
        input.sourceEntityType,
        input.sourceEntityId,
        input.targetEntityType,
        input.targetEntityId,
        input.proposedAction,
        JSON.stringify(input.actionParameters),
        input.rationale,
        createdBy,
      ],
    );
    if (inserted.rows[0]) {
      return { proposal: mapProposal(inserted.rows[0]), created: true };
    }
    const existing = await this.pool.query(
      `SELECT * FROM service_feedback_automation_proposals
        WHERE tenant_id = $1 AND idempotency_key = $2`,
      [input.tenantId, input.idempotencyKey],
    );
    return { proposal: mapProposal(existing.rows[0]), created: false };
  }

  async findProposalById(tenantId: string, id: string): Promise<AutomationProposal | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM service_feedback_automation_proposals WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? mapProposal(rows[0]) : null;
  }

  async listProposals(
    tenantId: string,
    status?: ProposalStatus,
  ): Promise<AutomationProposal[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM service_feedback_automation_proposals
        WHERE tenant_id = $1 AND ($2::text IS NULL OR status = $2)
        ORDER BY created_at DESC`,
      [tenantId, status ?? null],
    );
    return rows.map(mapProposal);
  }

  async transitionProposal(
    tenantId: string,
    id: string,
    expectedStatus: ProposalStatus,
    nextStatus: ProposalStatus,
    changes: {
      decidedBy?: string | null;
      decidedAt?: Date | null;
      decisionNote?: string | null;
      appliedAt?: Date | null;
      failureReason?: string | null;
    },
  ): Promise<AutomationProposal | null> {
    // The `status = $3` predicate is the concurrency guard: two simultaneous
    // approvals cannot both transition out of `pending`, so an effect can
    // never be applied twice.
    const autoDecidedAt =
      (nextStatus === "approved" || nextStatus === "rejected" || nextStatus === "superseded" || nextStatus === "applying") &&
      changes.decidedAt === undefined &&
      changes.decidedBy
        ? new Date()
        : (changes.decidedAt ?? null);

    const { rows } = await this.pool.query(
      `UPDATE service_feedback_automation_proposals
          SET status = $4,
              decided_by = COALESCE($5, decided_by),
              decided_at = COALESCE($6, decided_at),
              decision_note = COALESCE($7, decision_note),
              applied_at = COALESCE($8, applied_at),
              failure_reason = $9,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = $3
        RETURNING *`,
      [
        tenantId,
        id,
        expectedStatus,
        nextStatus,
        changes.decidedBy ?? null,
        autoDecidedAt,
        changes.decisionNote ?? null,
        changes.appliedAt ?? null,
        changes.failureReason ?? null,
      ],
    );
    return rows[0] ? mapProposal(rows[0]) : null;
  }
}
