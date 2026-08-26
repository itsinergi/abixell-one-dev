/**
 * Wave A1 — Service Quality Advanced (SQ-ADV-001…004).
 *
 * SQ-ADV-001 multidimensional SLA, SQ-ADV-002 structured RCA + advanced
 * CAPA, SQ-ADV-003 recurrence analytics, SQ-ADV-004 proposal-only feedback
 * automation. Complaint remains the owning aggregate: nothing here replaces
 * `complaints`, and CAPA lifecycle is delegated to the Workflow Engine via
 * `workflowInstanceId` exactly as the Complaint Engine delegates its own.
 */

import type { WorkweekWindow } from "./business-calendar.js";

// --- SQ-ADV-001 -----------------------------------------------------------

export interface BusinessCalendar {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  timeZone: string;
  isContinuous: boolean;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CalendarHoliday {
  id: string;
  calendarId: string;
  holidayDate: string;
  name: string;
}

export interface SlaPolicy {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  calendarId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** One cell of the matrix. A null dimension means "any". */
export interface SlaRule {
  id: string;
  tenantId: string;
  policyId: string;
  code: string;
  customerId: string | null;
  contractId: string | null;
  severityCode: string | null;
  categoryCode: string | null;
  responseMinutes: number | null;
  resolutionMinutes: number | null;
  priority: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** The dimensions a complaint presents for matching. */
export interface SlaMatchContext {
  customerId: string;
  contractId: string | null;
  severityCode: string | null;
  categoryCode: string | null;
}

export interface SlaTarget {
  id: string;
  tenantId: string;
  complaintId: string;
  policyId: string | null;
  ruleId: string | null;
  calendarId: string | null;
  policyCodeSnapshot: string | null;
  ruleCodeSnapshot: string | null;
  calendarCodeSnapshot: string | null;
  timeZoneSnapshot: string | null;
  /** Which dimensions the winning rule actually constrained — the stored
   * explanation of why this target applied. */
  matchedDimensions: Record<string, string | null>;
  startedAt: Date;
  responseMinutes: number | null;
  resolutionMinutes: number | null;
  responseDueAt: Date | null;
  resolutionDueAt: Date | null;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  responseBreached: boolean;
  resolutionBreached: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBusinessCalendarInput {
  tenantId: string;
  code: string;
  name: string;
  description?: string | null;
  timeZone: string;
  isContinuous?: boolean;
  isDefault?: boolean;
  windows: WorkweekWindow[];
}

export interface CreateSlaPolicyInput {
  tenantId: string;
  code: string;
  name: string;
  description?: string | null;
  calendarId: string;
}

export interface CreateSlaRuleInput {
  tenantId: string;
  policyId: string;
  code: string;
  customerId?: string | null;
  contractId?: string | null;
  severityCode?: string | null;
  categoryCode?: string | null;
  responseMinutes?: number | null;
  resolutionMinutes?: number | null;
  priority?: number;
}

export interface CreateSlaTargetInput {
  tenantId: string;
  complaintId: string;
  policyId: string | null;
  ruleId: string | null;
  calendarId: string | null;
  policyCodeSnapshot: string | null;
  ruleCodeSnapshot: string | null;
  calendarCodeSnapshot: string | null;
  timeZoneSnapshot: string | null;
  matchedDimensions: Record<string, string | null>;
  startedAt: Date;
  responseMinutes: number | null;
  resolutionMinutes: number | null;
  responseDueAt: Date | null;
  resolutionDueAt: Date | null;
}

// --- SQ-ADV-002 -----------------------------------------------------------

export interface RootCauseCategory {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RcaFinding {
  id: string;
  tenantId: string;
  complaintId: string;
  rootCauseCategoryId: string;
  analysisMethodCode: string | null;
  statement: string;
  evidenceSummary: string | null;
  isPrimary: boolean;
  identifiedBy: string | null;
  identifiedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type CapaActionType = "corrective" | "preventive";
export type CapaStatus =
  | "open"
  | "in_progress"
  | "completed"
  | "verified"
  | "ineffective"
  | "cancelled";
export type CapaVerdict = "effective" | "ineffective";

export interface CapaAction {
  id: string;
  tenantId: string;
  complaintId: string;
  rcaFindingId: string | null;
  actionNumber: string;
  actionType: CapaActionType;
  title: string;
  description: string | null;
  ownerUserId: string | null;
  dueDate: string | null;
  status: CapaStatus;
  completedAt: Date | null;
  completionNote: string | null;
  effectivenessVerdict: CapaVerdict | null;
  effectivenessNote: string | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  workflowInstanceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRootCauseCategoryInput {
  tenantId: string;
  code: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  sortOrder?: number;
}

export interface CreateRcaFindingInput {
  tenantId: string;
  complaintId: string;
  rootCauseCategoryId: string;
  analysisMethodCode?: string | null;
  statement: string;
  evidenceSummary?: string | null;
  isPrimary: boolean;
  identifiedBy: string | null;
}

export interface CreateCapaActionInput {
  tenantId: string;
  complaintId: string;
  rcaFindingId: string | null;
  actionNumber: string;
  actionType: CapaActionType;
  title: string;
  description?: string | null;
  ownerUserId?: string | null;
  dueDate?: string | null;
}

// --- SQ-ADV-003 -----------------------------------------------------------

export type RecurrenceGroupBy =
  | "category"
  | "severity"
  | "customer"
  | "site"
  | "service"
  | "root_cause";

export interface RecurrenceRule {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  groupBy: RecurrenceGroupBy;
  windowDays: number;
  minimumOccurrences: number;
  customerId: string | null;
  severityCode: string | null;
  categoryCode: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRecurrenceRuleInput {
  tenantId: string;
  code: string;
  name: string;
  description?: string | null;
  groupBy: RecurrenceGroupBy;
  windowDays: number;
  minimumOccurrences: number;
  customerId?: string | null;
  severityCode?: string | null;
  categoryCode?: string | null;
}

/** One detected recurring group, with the evidence that produced it. */
export interface RecurrenceCluster {
  groupKey: string | null;
  groupLabel: string | null;
  occurrences: number;
  firstOccurredAt: Date;
  lastOccurredAt: Date;
  complaintIds: string[];
}

export interface RecurrenceDetection {
  ruleCode: string;
  ruleName: string;
  groupBy: RecurrenceGroupBy;
  windowDays: number;
  minimumOccurrences: number;
  windowStart: Date;
  windowEnd: Date;
  clusters: RecurrenceCluster[];
}

export interface SlaPerformanceRow {
  severityCode: string | null;
  totalWithTarget: number;
  responseBreached: number;
  resolutionBreached: number;
  openPastDue: number;
}

/** Durable Complaint lifecycle event awaiting this projection. The Event
 * Foundation owns the log; Service Quality stores only an idempotent receipt. */
export interface ServiceQualityLifecycleEvent {
  id: string;
  tenantId: string;
  eventType:
    | "complaint.submitted"
    | "complaint.acknowledged"
    | "complaint.customer_confirmed";
  complaintId: string;
  occurredAt: Date;
  createdBy: string | null;
}

export interface ServiceQualityReconciliationResult {
  scanned: number;
  processed: number;
  failed: number;
}

export interface CapaEffectivenessRow {
  status: CapaStatus;
  actionType: CapaActionType;
  actionCount: number;
  effectiveCount: number;
  ineffectiveCount: number;
}

// --- SQ-ADV-004 -----------------------------------------------------------

export type AutomationTriggerEvent =
  | "survey_score_below_threshold"
  | "complaint_reopened"
  | "sla_resolution_breached";

export type AutomationAction =
  | "reopen_complaint"
  | "raise_complaint_severity"
  | "create_capa_action";

export type ProposalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "applying"
  | "applied"
  | "failed"
  | "superseded";

export interface AutomationRule {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  triggerEvent: AutomationTriggerEvent;
  scoreThreshold: number | null;
  proposedAction: AutomationAction;
  actionParameters: Record<string, unknown>;
  /** Always true — CHECK-pinned in the schema so automation can never
   * become autonomous. */
  requiresApproval: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutomationProposal {
  id: string;
  tenantId: string;
  ruleId: string;
  idempotencyKey: string;
  sourceEntityType: string;
  sourceEntityId: string;
  targetEntityType: string;
  targetEntityId: string;
  proposedAction: AutomationAction;
  actionParameters: Record<string, unknown>;
  rationale: string;
  status: ProposalStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  appliedAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAutomationRuleInput {
  tenantId: string;
  code: string;
  name: string;
  description?: string | null;
  triggerEvent: AutomationTriggerEvent;
  scoreThreshold?: number | null;
  proposedAction: AutomationAction;
  actionParameters?: Record<string, unknown>;
}

export interface CreateAutomationProposalInput {
  tenantId: string;
  ruleId: string;
  idempotencyKey: string;
  sourceEntityType: string;
  sourceEntityId: string;
  targetEntityType: string;
  targetEntityId: string;
  proposedAction: AutomationAction;
  actionParameters: Record<string, unknown>;
  rationale: string;
}

// --- repository port ------------------------------------------------------

export interface ServiceQualityRepository {
  // SQ-ADV-001
  createCalendar(
    input: CreateBusinessCalendarInput,
    createdBy: string | null,
  ): Promise<BusinessCalendar>;
  findCalendarById(tenantId: string, id: string): Promise<BusinessCalendar | null>;
  findCalendarByCode(tenantId: string, code: string): Promise<BusinessCalendar | null>;
  listCalendars(tenantId: string): Promise<BusinessCalendar[]>;
  listCalendarWindows(tenantId: string, calendarId: string): Promise<WorkweekWindow[]>;
  addHoliday(
    tenantId: string,
    calendarId: string,
    holidayDate: string,
    name: string,
    createdBy: string | null,
  ): Promise<CalendarHoliday>;
  listHolidays(tenantId: string, calendarId: string): Promise<CalendarHoliday[]>;

  createSlaPolicy(input: CreateSlaPolicyInput, createdBy: string | null): Promise<SlaPolicy>;
  findSlaPolicyById(tenantId: string, id: string): Promise<SlaPolicy | null>;
  listSlaPolicies(tenantId: string): Promise<SlaPolicy[]>;
  createSlaRule(input: CreateSlaRuleInput, createdBy: string | null): Promise<SlaRule>;
  listSlaRules(tenantId: string, policyId: string): Promise<SlaRule[]>;
  /**
   * Every ACTIVE rule that could match the context — a rule matches a
   * dimension when its column is NULL (any) or equal. Ranking is applied in
   * the service so the winning-rule explanation is one readable, tested
   * function rather than buried in SQL.
   */
  listCandidateSlaRules(tenantId: string, context: SlaMatchContext): Promise<SlaRule[]>;

  /** Idempotently freezes the first resolved target for a Complaint. A replayed
   * lifecycle event returns the existing snapshot rather than re-resolving it
   * against possibly edited policy data. */
  createSlaTargetIfAbsent(
    input: CreateSlaTargetInput,
    createdBy: string | null,
  ): Promise<{ target: SlaTarget; created: boolean }>;
  findSlaTargetByComplaint(tenantId: string, complaintId: string): Promise<SlaTarget | null>;
  markFirstResponse(
    tenantId: string,
    complaintId: string,
    at: Date,
    breached: boolean,
  ): Promise<SlaTarget>;
  markResolved(
    tenantId: string,
    complaintId: string,
    at: Date,
    breached: boolean,
  ): Promise<SlaTarget>;
  summariseSlaPerformance(
    tenantId: string,
    customerIds: string[],
    now: Date,
  ): Promise<SlaPerformanceRow[]>;
  listPendingLifecycleEvents(
    tenantId: string,
    limit: number,
  ): Promise<ServiceQualityLifecycleEvent[]>;
  recordLifecycleEventProcessed(
    tenantId: string,
    domainEventId: string,
  ): Promise<void>;

  // SQ-ADV-002
  createRootCauseCategory(
    input: CreateRootCauseCategoryInput,
    createdBy: string | null,
  ): Promise<RootCauseCategory>;
  findRootCauseCategoryById(tenantId: string, id: string): Promise<RootCauseCategory | null>;
  listRootCauseCategories(tenantId: string): Promise<RootCauseCategory[]>;

  createRcaFinding(input: CreateRcaFindingInput, createdBy: string | null): Promise<RcaFinding>;
  findRcaFindingById(tenantId: string, id: string): Promise<RcaFinding | null>;
  listRcaFindings(tenantId: string, complaintId: string): Promise<RcaFinding[]>;
  /** Demotes any existing primary finding so the partial unique index can
   * never be violated by a legitimate change of mind. */
  clearPrimaryRcaFinding(
    tenantId: string,
    complaintId: string,
    updatedBy: string | null,
  ): Promise<void>;

  createCapaAction(input: CreateCapaActionInput, createdBy: string | null): Promise<CapaAction>;
  findCapaActionById(tenantId: string, id: string): Promise<CapaAction | null>;
  listCapaActions(tenantId: string, complaintId: string): Promise<CapaAction[]>;
  listCapaActionsByCustomers(tenantId: string, customerIds: string[]): Promise<CapaAction[]>;
  updateCapaStatus(
    tenantId: string,
    id: string,
    status: CapaStatus,
    updatedBy: string | null,
    extra?: { completedAt?: Date | null; completionNote?: string | null },
  ): Promise<CapaAction>;
  recordCapaVerification(
    tenantId: string,
    id: string,
    verdict: CapaVerdict,
    note: string | null,
    verifiedBy: string,
  ): Promise<CapaAction>;
  setCapaWorkflowInstance(tenantId: string, id: string, workflowInstanceId: string): Promise<void>;
  summariseCapaEffectiveness(
    tenantId: string,
    customerIds: string[],
  ): Promise<CapaEffectivenessRow[]>;

  // SQ-ADV-003
  createRecurrenceRule(
    input: CreateRecurrenceRuleInput,
    createdBy: string | null,
  ): Promise<RecurrenceRule>;
  findRecurrenceRuleById(tenantId: string, id: string): Promise<RecurrenceRule | null>;
  listRecurrenceRules(tenantId: string): Promise<RecurrenceRule[]>;
  /**
   * Deterministic, bounded aggregation for one rule. `customerIds` is the
   * actor's Data Scope, applied inside the query so scope is enforced by the
   * database, not by post-filtering.
   */
  detectRecurrence(
    tenantId: string,
    rule: RecurrenceRule,
    customerIds: string[],
    windowStart: Date,
    windowEnd: Date,
  ): Promise<RecurrenceCluster[]>;

  // SQ-ADV-004
  createAutomationRule(
    input: CreateAutomationRuleInput,
    createdBy: string | null,
  ): Promise<AutomationRule>;
  findAutomationRuleById(tenantId: string, id: string): Promise<AutomationRule | null>;
  listAutomationRules(tenantId: string): Promise<AutomationRule[]>;
  setAutomationRuleActive(
    tenantId: string,
    id: string,
    isActive: boolean,
    updatedBy: string | null,
  ): Promise<AutomationRule>;
  listActiveAutomationRulesByTrigger(
    tenantId: string,
    triggerEvent: AutomationTriggerEvent,
  ): Promise<AutomationRule[]>;

  /** Returns the existing proposal when the idempotency key was already
   * used, so a replayed event is a no-op instead of a duplicate. */
  createProposalIfAbsent(
    input: CreateAutomationProposalInput,
    createdBy: string | null,
  ): Promise<{ proposal: AutomationProposal; created: boolean }>;
  findProposalById(tenantId: string, id: string): Promise<AutomationProposal | null>;
  listProposals(tenantId: string, status?: ProposalStatus): Promise<AutomationProposal[]>;
  /**
   * Conditional status transition: updates only when the row is still in
   * `expectedStatus`, so two concurrent approvals cannot both apply an
   * effect. Returns null when the precondition no longer holds.
   */
  transitionProposal(
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
  ): Promise<AutomationProposal | null>;
}
