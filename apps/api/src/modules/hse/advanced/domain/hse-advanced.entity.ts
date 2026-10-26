/**
 * HSE Advanced — domain types (Wave A7, HSE-ADV-001…007).
 *
 * Layered on top of the frozen HSE Core surface (`hse_records`,
 * `hse_follow_ups`, 1768000000000) without altering either. Core is never
 * modified and never depends on anything declared here: a tenant with no
 * framework, no matrix, no permit, no programme, no monitoring point and no
 * CAPA behaves exactly as it did before this module existed.
 *
 * Governing decisions (ADR-0027):
 * - §1 Core follow-up action and Advanced CAPA are separate aggregates. A CAPA
 *   may reference a Core follow-up; it never mutates one, and no Core path may
 *   require a CAPA to exist.
 * - §2 Investigation methodology is versioned metadata. An investigation keeps
 *   the `frameworkVersion` it was recorded under.
 * - §3 Risk rating is stored on the assessment. The matrix is tenant
 *   configuration; the rating a matrix produced is written at assessment time,
 *   so re-configuring the matrix cannot re-rate the past.
 * - §4 Permit content, validity and isolation belong here; permit *lifecycle*
 *   belongs exclusively to the Workflow Engine via `workflowInstanceId`. There
 *   is no local status machine.
 * - §5 Inspection/audit programmes are scheduled templates over findings; the
 *   Scheduler owns when a job fires.
 * - §6 Environmental monitoring is measurement + threshold + breach. It keeps
 *   no corrective-action list of its own.
 * - §7 Indicators are computed snapshots with the window recorded, never
 *   operator-editable.
 * - §8 Documents reuse Document Core (ADR-0012); nothing here stores files.
 */

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

export type RiskAssessmentType = "jsa" | "hira";
export const RISK_ASSESSMENT_TYPES: RiskAssessmentType[] = ["jsa", "hira"];

export type AuditProgrammeType = "inspection" | "audit";
export const AUDIT_PROGRAMME_TYPES: AuditProgrammeType[] = ["inspection", "audit"];

export type AuditFindingType = "observation" | "nonconformity" | "major_nonconformity";
export const AUDIT_FINDING_TYPES: AuditFindingType[] = [
  "observation",
  "nonconformity",
  "major_nonconformity",
];

export type CapaActionType = "corrective" | "preventive";
export const CAPA_ACTION_TYPES: CapaActionType[] = ["corrective", "preventive"];

export type CapaStatus = "open" | "in_progress" | "verification" | "closed" | "cancelled";
export const CAPA_STATUSES: CapaStatus[] = [
  "open",
  "in_progress",
  "verification",
  "closed",
  "cancelled",
];

/** A contributing factor recorded against an investigation's cause taxonomy. */
export interface ContributingFactor {
  category: string;
  description: string;
  isRootCause: boolean;
}

/** A risk-control line, with the residual rating it leaves behind. */
export interface RiskControl {
  description: string;
  controlType: string | null;
  residualLikelihood: number | null;
  residualSeverity: number | null;
}

/** One isolation / safety condition on a permit. */
export interface PermitIsolationCondition {
  conditionType: string;
  description: string;
  verifiedAt: string | null;
}

/** One checklist item on an audit programme. */
export interface AuditChecklistItem {
  code: string;
  question: string;
  isMandatory: boolean;
}

/** One recorded result against a checklist item on an occurrence. */
export interface AuditResult {
  itemCode: string;
  result: string;
  note: string | null;
}

/** A scale point on a risk matrix axis. */
export interface RiskScalePoint {
  value: number;
  label: string;
}

// ---------------------------------------------------------------------------
// HSE-ADV-001 — structured investigation
// ---------------------------------------------------------------------------

export interface HseInvestigationFramework {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  causeCategories: string[];
  version: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateInvestigationFrameworkInput {
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  causeCategories: string[];
  createdBy: string | null;
}

export interface HseInvestigation {
  id: string;
  tenantId: string;
  hseRecordId: string;
  frameworkId: string;
  /** Copied at creation; never updated, so history keeps its framework (§2). */
  frameworkCode: string;
  frameworkVersion: number;
  leadInvestigatorUserId: string | null;
  startedAt: Date;
  concludedAt: Date | null;
  findings: string | null;
  rootCause: string | null;
  contributingFactors: ContributingFactor[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateInvestigationInput {
  tenantId: string;
  hseRecordId: string;
  frameworkId: string;
  frameworkCode: string;
  frameworkVersion: number;
  leadInvestigatorUserId: string | null;
  createdBy: string | null;
}

export interface UpdateInvestigationInput {
  leadInvestigatorUserId?: string | null;
  findings?: string | null;
  rootCause?: string | null;
  contributingFactors?: ContributingFactor[];
  concludedAt?: Date | null;
  updatedBy: string | null;
}

// ---------------------------------------------------------------------------
// HSE-ADV-002 — risk matrix, JSA/HIRA assessments
// ---------------------------------------------------------------------------

export interface HseRiskMatrix {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  likelihoodScale: RiskScalePoint[];
  severityScale: RiskScalePoint[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface HseRiskMatrixCell {
  id: string;
  tenantId: string;
  matrixId: string;
  likelihood: number;
  severity: number;
  bandCode: string;
  /** NUMERIC(10,2) as text — exact decimal, never a JS float. */
  score: string;
}

export interface CreateRiskMatrixInput {
  tenantId: string;
  code: string;
  name: string;
  likelihoodScale: RiskScalePoint[];
  severityScale: RiskScalePoint[];
  cells: { likelihood: number; severity: number; bandCode: string; score: string }[];
  createdBy: string | null;
}

export interface HseRiskAssessment {
  id: string;
  tenantId: string;
  hseRecordId: string | null;
  projectId: string | null;
  assessmentType: RiskAssessmentType;
  title: string;
  taskDescription: string | null;
  matrixId: string;
  likelihood: number;
  severity: number;
  /** Stored at assessment time; a later matrix edit cannot re-rate it (§3). */
  bandCode: string;
  score: string;
  controls: RiskControl[];
  residualLikelihood: number | null;
  residualSeverity: number | null;
  residualBandCode: string | null;
  residualScore: string | null;
  assessedByUserId: string | null;
  assessedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRiskAssessmentInput {
  tenantId: string;
  hseRecordId: string | null;
  projectId: string | null;
  assessmentType: RiskAssessmentType;
  title: string;
  taskDescription: string | null;
  matrixId: string;
  likelihood: number;
  severity: number;
  bandCode: string;
  score: string;
  controls: RiskControl[];
  residualLikelihood: number | null;
  residualSeverity: number | null;
  residualBandCode: string | null;
  residualScore: string | null;
  assessedByUserId: string | null;
  createdBy: string | null;
}

// ---------------------------------------------------------------------------
// HSE-ADV-003 — Permit to Work
// ---------------------------------------------------------------------------

/**
 * No status field. Lifecycle is the Workflow Engine's (§4); `validFrom` and
 * `validTo` are content its transitions consult, not a second state machine.
 */
export interface HsePermit {
  id: string;
  tenantId: string;
  permitNumber: string;
  permitTypeCode: string;
  title: string;
  description: string | null;
  organizationUnitId: string | null;
  projectId: string | null;
  siteId: string | null;
  locationDetail: string | null;
  validFrom: Date;
  validTo: Date;
  isolationConditions: PermitIsolationCondition[];
  riskAssessmentId: string | null;
  workflowInstanceId: string | null;
  requestedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePermitInput {
  tenantId: string;
  permitNumber: string;
  permitTypeCode: string;
  title: string;
  description: string | null;
  organizationUnitId: string | null;
  projectId: string | null;
  siteId: string | null;
  locationDetail: string | null;
  validFrom: Date;
  validTo: Date;
  isolationConditions: PermitIsolationCondition[];
  riskAssessmentId: string | null;
  requestedByUserId: string | null;
  createdBy: string | null;
}

export interface UpdatePermitInput {
  permitTypeCode?: string;
  title?: string;
  description?: string | null;
  organizationUnitId?: string | null;
  projectId?: string | null;
  siteId?: string | null;
  locationDetail?: string | null;
  validFrom?: Date;
  validTo?: Date;
  isolationConditions?: PermitIsolationCondition[];
  riskAssessmentId?: string | null;
  updatedBy: string | null;
}

// ---------------------------------------------------------------------------
// HSE-ADV-004 — planned inspection and audit programmes
// ---------------------------------------------------------------------------

export interface HseAuditProgramme {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  programmeType: AuditProgrammeType;
  frequencyDays: number;
  checklist: AuditChecklistItem[];
  organizationUnitId: string | null;
  siteId: string | null;
  ownerUserId: string | null;
  isActive: boolean;
  /** DATE as YYYY-MM-DD; the Scheduler's own bookkeeping of the last firing. */
  lastScheduledFor: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAuditProgrammeInput {
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  programmeType: AuditProgrammeType;
  frequencyDays: number;
  checklist: AuditChecklistItem[];
  organizationUnitId: string | null;
  siteId: string | null;
  ownerUserId: string | null;
  createdBy: string | null;
}

export interface HseAuditOccurrence {
  id: string;
  tenantId: string;
  programmeId: string;
  scheduledFor: string;
  performedAt: Date | null;
  performedByUserId: string | null;
  results: AuditResult[];
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface HseAuditFinding {
  id: string;
  tenantId: string;
  occurrenceId: string;
  findingType: AuditFindingType;
  checklistItemCode: string | null;
  description: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// HSE-ADV-005 — environmental monitoring
// ---------------------------------------------------------------------------

export interface HseMonitoringPoint {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  parameterCode: string;
  unit: string;
  /** NUMERIC(20,4) as text. NULL on a side means that side is unbounded. */
  thresholdMin: string | null;
  thresholdMax: string | null;
  organizationUnitId: string | null;
  siteId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMonitoringPointInput {
  tenantId: string;
  code: string;
  name: string;
  parameterCode: string;
  unit: string;
  thresholdMin: string | null;
  thresholdMax: string | null;
  organizationUnitId: string | null;
  siteId: string | null;
  createdBy: string | null;
}

export interface HseMonitoringReading {
  id: string;
  tenantId: string;
  pointId: string;
  measuredAt: Date;
  /** NUMERIC(20,4) as text. */
  value: string;
  /** Recorded against the thresholds as they stood at write time. */
  isBreach: boolean;
  recordedByUserId: string | null;
  note: string | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// HSE-ADV-006 — formal CAPA (separate aggregate from Core follow-up, §1)
// ---------------------------------------------------------------------------

export interface HseCapa {
  id: string;
  tenantId: string;
  capaNumber: string;
  title: string;
  description: string | null;
  hseRecordId: string | null;
  investigationId: string | null;
  auditFindingId: string | null;
  monitoringReadingId: string | null;
  /** Read-only link to the Core follow-up; this module never mutates it. */
  coreFollowUpId: string | null;
  rootCause: string | null;
  actionType: CapaActionType;
  status: CapaStatus;
  ownerUserId: string | null;
  dueDate: string | null;
  verificationNotes: string | null;
  verifiedAt: Date | null;
  verifiedByUserId: string | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCapaInput {
  tenantId: string;
  capaNumber: string;
  title: string;
  description: string | null;
  hseRecordId: string | null;
  investigationId: string | null;
  auditFindingId: string | null;
  monitoringReadingId: string | null;
  coreFollowUpId: string | null;
  rootCause: string | null;
  actionType: CapaActionType;
  ownerUserId: string | null;
  dueDate: string | null;
  createdBy: string | null;
}

export interface HseCapaAction {
  id: string;
  tenantId: string;
  capaId: string;
  description: string;
  ownerUserId: string | null;
  dueDate: string | null;
  completedAt: Date | null;
  completionNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// HSE-ADV-007 — computed safety indicators
// ---------------------------------------------------------------------------

export interface HseIndicatorSnapshot {
  id: string;
  tenantId: string;
  organizationUnitId: string | null;
  windowStart: string;
  windowEnd: string;
  exposureHours: string | null;
  nearMissCount: number;
  observationCount: number;
  inspectionCount: number;
  capaOpenedCount: number;
  capaClosedCount: number;
  capaClosureRate: string | null;
  permitCount: number;
  incidentCount: number;
  lostTimeIncidentCount: number;
  lostDays: number;
  incidentFrequencyRate: string | null;
  severityRate: string | null;
  createdAt: Date;
}

export interface CreateIndicatorSnapshotInput {
  tenantId: string;
  organizationUnitId: string | null;
  windowStart: string;
  windowEnd: string;
  exposureHours: string | null;
  nearMissCount: number;
  observationCount: number;
  inspectionCount: number;
  capaOpenedCount: number;
  capaClosedCount: number;
  capaClosureRate: string | null;
  permitCount: number;
  incidentCount: number;
  lostTimeIncidentCount: number;
  lostDays: number;
  incidentFrequencyRate: string | null;
  severityRate: string | null;
  computedBy: string | null;
}

/**
 * The raw counts an indicator computation draws from, gathered in one pass.
 *
 * Nothing here is a rate: rates are derived in `hse-advanced.math.ts`, so the
 * repository stays a reader and the arithmetic stays testable in isolation.
 *
 * Two denominators are NOT here because no table records them: `exposureHours`
 * and `lostDays` come from the tenant's own attendance/HR facts and are
 * supplied to the computation, then recorded on the snapshot like every other
 * figure (ADR-0027 §7). Absent them the rate indicators report null rather than
 * a rate over an invented base.
 */
export interface IndicatorFacts {
  incidentCount: number;
  /** Incidents whose category is the tenant's configured near-miss category. */
  nearMissCount: number;
  observationCount: number;
  /** Incidents whose severity is the tenant's configured lost-time severity. */
  lostTimeIncidentCount: number;
  inspectionCount: number;
  permitCount: number;
  capaOpenedCount: number;
  capaClosedCount: number;
}

// ---------------------------------------------------------------------------
// Cross-domain references (clean ports — nothing domain-internal is imported)
// ---------------------------------------------------------------------------

/** The subset of the frozen Core record an Advanced row needs to anchor to. */
export interface CoreHseRecordRef {
  id: string;
  tenantId: string;
  recordNumber: string;
  recordType: string;
  organizationUnitId: string | null;
  projectId: string | null;
}

/**
 * The subset of the frozen Core follow-up a CAPA may reference. Read-only: the
 * Advanced side never completes, reassigns or deletes one (§1).
 */
export interface CoreFollowUpRef {
  id: string;
  tenantId: string;
  hseRecordId: string;
  title: string;
  completedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

export interface HseAdvancedRepository {
  // --- Investigations (HSE-ADV-001) --------------------------------------
  createInvestigationFramework(
    input: CreateInvestigationFrameworkInput,
  ): Promise<HseInvestigationFramework>;
  findInvestigationFrameworkById(id: string): Promise<HseInvestigationFramework | null>;
  listInvestigationFrameworks(tenantId: string): Promise<HseInvestigationFramework[]>;
  createInvestigation(input: CreateInvestigationInput): Promise<HseInvestigation>;
  findInvestigationById(id: string): Promise<HseInvestigation | null>;
  findInvestigationByRecord(hseRecordId: string): Promise<HseInvestigation | null>;
  listInvestigations(tenantId: string, orgUnitIds: string[] | null): Promise<HseInvestigation[]>;
  updateInvestigation(
    id: string,
    input: UpdateInvestigationInput,
  ): Promise<HseInvestigation | null>;

  // --- Risk (HSE-ADV-002) -------------------------------------------------
  createRiskMatrix(input: CreateRiskMatrixInput): Promise<HseRiskMatrix>;
  findRiskMatrixById(id: string): Promise<HseRiskMatrix | null>;
  findActiveRiskMatrix(tenantId: string): Promise<HseRiskMatrix | null>;
  listRiskMatrixCells(matrixId: string): Promise<HseRiskMatrixCell[]>;
  createRiskAssessment(input: CreateRiskAssessmentInput): Promise<HseRiskAssessment>;
  findRiskAssessmentById(id: string): Promise<HseRiskAssessment | null>;
  listRiskAssessments(
    tenantId: string,
    filter: { hseRecordId?: string; projectId?: string },
    orgUnitIds: string[] | null,
  ): Promise<HseRiskAssessment[]>;

  // --- Permits (HSE-ADV-003) ---------------------------------------------
  createPermit(input: CreatePermitInput): Promise<HsePermit>;
  findPermitById(id: string): Promise<HsePermit | null>;
  findPermitByNumber(tenantId: string, permitNumber: string): Promise<HsePermit | null>;
  listPermits(tenantId: string, orgUnitIds: string[] | null): Promise<HsePermit[]>;
  updatePermit(id: string, input: UpdatePermitInput): Promise<HsePermit | null>;
  /** The only lifecycle write on a permit: bind the Engine instance (§4). */
  setPermitWorkflowInstance(id: string, workflowInstanceId: string): Promise<void>;

  // --- Programmes (HSE-ADV-004) ------------------------------------------
  createAuditProgramme(input: CreateAuditProgrammeInput): Promise<HseAuditProgramme>;
  findAuditProgrammeById(id: string): Promise<HseAuditProgramme | null>;
  listAuditProgrammes(tenantId: string, orgUnitIds: string[] | null): Promise<HseAuditProgramme[]>;
  createAuditOccurrence(input: {
    tenantId: string;
    programmeId: string;
    scheduledFor: string;
  }): Promise<HseAuditOccurrence>;
  findAuditOccurrenceById(id: string): Promise<HseAuditOccurrence | null>;
  listAuditOccurrences(programmeId: string): Promise<HseAuditOccurrence[]>;
  completeAuditOccurrence(input: {
    tenantId: string;
    occurrenceId: string;
    performedAt: Date;
    performedBy: string;
    results: AuditResult[];
    notes: string | null;
  }): Promise<HseAuditOccurrence | null>;
  createAuditFinding(input: {
    tenantId: string;
    occurrenceId: string;
    findingType: AuditFindingType;
    checklistItemCode: string | null;
    description: string;
    createdBy: string | null;
  }): Promise<HseAuditFinding>;
  findAuditFindingById(id: string): Promise<HseAuditFinding | null>;
  listAuditFindings(occurrenceId: string): Promise<HseAuditFinding[]>;

  // --- Monitoring (HSE-ADV-005) ------------------------------------------
  createMonitoringPoint(input: CreateMonitoringPointInput): Promise<HseMonitoringPoint>;
  findMonitoringPointById(id: string): Promise<HseMonitoringPoint | null>;
  listMonitoringPoints(tenantId: string, orgUnitIds: string[] | null): Promise<HseMonitoringPoint[]>;
  createMonitoringReading(input: {
    tenantId: string;
    pointId: string;
    measuredAt: Date;
    value: string;
    isBreach: boolean;
    recordedBy: string | null;
    note: string | null;
  }): Promise<HseMonitoringReading>;
  findMonitoringReadingById(id: string): Promise<HseMonitoringReading | null>;
  listMonitoringReadings(pointId: string, limit: number): Promise<HseMonitoringReading[]>;

  // --- CAPA (HSE-ADV-006) -------------------------------------------------
  createCapa(input: CreateCapaInput): Promise<HseCapa>;
  findCapaById(id: string): Promise<HseCapa | null>;
  findCapaByNumber(tenantId: string, capaNumber: string): Promise<HseCapa | null>;
  listCapas(tenantId: string, orgUnitIds: string[] | null): Promise<HseCapa[]>;
  updateCapaStatus(input: {
    tenantId: string;
    capaId: string;
    status: CapaStatus;
    verificationNotes?: string | null;
    verifiedAt?: Date | null;
    verifiedBy?: string | null;
    closedAt?: Date | null;
    updatedBy: string | null;
  }): Promise<HseCapa | null>;
  createCapaAction(input: {
    tenantId: string;
    capaId: string;
    description: string;
    ownerUserId: string | null;
    dueDate: string | null;
    createdBy: string | null;
  }): Promise<HseCapaAction>;
  listCapaActions(capaId: string): Promise<HseCapaAction[]>;
  completeCapaAction(input: {
    tenantId: string;
    actionId: string;
    completedAt: Date;
    completionNotes: string | null;
  }): Promise<HseCapaAction | null>;

  // --- Indicators (HSE-ADV-007) ------------------------------------------
  createIndicatorSnapshot(input: CreateIndicatorSnapshotInput): Promise<HseIndicatorSnapshot>;
  findIndicatorSnapshotById(id: string): Promise<HseIndicatorSnapshot | null>;
  listIndicatorSnapshots(
    tenantId: string,
    orgUnitIds: string[] | null,
  ): Promise<HseIndicatorSnapshot[]>;

  /**
   * Count the recorded facts an indicator window covers, in one pass. The
   * category and severity codes that mark a near-miss or a lost-time incident
   * are tenant Configuration, so they are passed in rather than hardcoded.
   */
  gatherIndicatorFacts(input: {
    tenantId: string;
    windowStart: string;
    windowEnd: string;
    organizationUnitId: string | null;
    orgUnitIds: string[] | null;
    nearMissCategoryCode: string | null;
    lostTimeSeverityCode: string | null;
  }): Promise<IndicatorFacts>;

  // --- Cross-domain reads (clean reference ports) -------------------------
  findCoreRecord(tenantId: string, hseRecordId: string): Promise<CoreHseRecordRef | null>;
  findCoreFollowUp(tenantId: string, followUpId: string): Promise<CoreFollowUpRef | null>;
  projectExists(tenantId: string, projectId: string): Promise<boolean>;
  organizationUnitExists(tenantId: string, id: string): Promise<boolean>;
  siteExists(tenantId: string, id: string): Promise<boolean>;
  userExists(tenantId: string, id: string): Promise<boolean>;
  riskMatrixCell(
    matrixId: string,
    likelihood: number,
    severity: number,
  ): Promise<HseRiskMatrixCell | null>;
}
