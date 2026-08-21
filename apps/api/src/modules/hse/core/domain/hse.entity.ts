/**
 * HSE Core — domain types (Phase 7, HSE-CORE-001…010).
 *
 * Built under the frozen target repository architecture
 * (`modules/<module>/core/{domain,application,infrastructure,api}`).
 *
 * Scope discipline: Core is *capture and follow-up*. It answers what
 * incident or observation occurred, when and where, who reported it, how
 * it is classified, what evidence exists, what basic follow-up is required,
 * and what is its lifecycle state. It contains no root-cause analysis,
 * CAPA engine, risk assessment (JSA/HIRA/HIRADC), permit to work,
 * inspection/audit programmes, environmental monitoring, occupational-health
 * records, LTIFR/TRIFR, leading/lagging indicators, or predictive safety —
 * all of those are Advanced HSE capabilities.
 *
 * Key design decisions:
 * - ONE aggregate (`hse_records`) with a `record_type` discriminator.
 *   Incident and observation share the same lifecycle; two nearly-identical
 *   aggregates would diverge without business reason.
 * - NO status column. Lifecycle state is owned by the Workflow Engine via
 *   `workflow_instance_id` (BC-GEN-003).
 * - Category and severity use Reference Data — no industry taxonomy hardcoded.
 * - Location reuses existing org-unit/project/site references.
 * - Follow-up is a separate table (`hse_follow_ups`) — NOT a CAPA system.
 * - Evidence uses Document Core with an entity authorization resolver.
 * - Numbering uses the Numbering Core.
 * - No hard delete surface: safety history must remain readable.
 */

/** The structural classification of an HSE record. */
export type HseRecordType = "incident" | "observation";
export const HSE_RECORD_TYPES: HseRecordType[] = ["incident", "observation"];

/**
 * The authoritative HSE record (HSE-CORE-001/002).
 *
 * Incidents and observations share one aggregate because their lifecycle,
 * evidence, follow-up, and authorisation model are identical. `record_type`
 * is classification, not lifecycle state.
 */
export interface HseRecord {
  id: string;
  tenantId: string;

  /** Business number from Numbering Core (HSE-CORE-008). */
  recordNumber: string;

  /** `incident` or `observation` (HSE-CORE-001/002). */
  recordType: HseRecordType;

  /** Reference Data code. Configurable per tenant, no industry hardcode. */
  categoryCode: string | null;
  /** Reference Data code. Severity ≠ priority; this is consequence severity. */
  severityCode: string | null;

  /** When the event actually happened (HSE-CORE-001, prompt §17). */
  occurredAt: Date;
  /** When it was entered (prompt §17). */
  reportedAt: Date;

  /** Human-readable title for the register view. */
  title: string;
  /** Brief one-sentence summary for list views. */
  summary: string | null;
  /** Full narrative description. */
  description: string | null;
  /** Immediate / basic action taken at the time of the event. NOT a CAPA field. */
  immediateAction: string | null;

  /** Organisation unit where the event occurred (HSE-CORE-003). */
  organizationUnitId: string | null;
  /** Project context (HSE-CORE-003). */
  projectId: string | null;
  /** Site context (HSE-CORE-003). */
  siteId: string | null;
  /** Free-text sub-location detail (e.g. "Workshop bay 3"). */
  locationDetail: string | null;

  /** The user who reported this record (HSE-CORE-001). */
  reportedByUserId: string;

  /** Primary responsible user for follow-up / closure (prompt §16). */
  responsibleUserId: string | null;
  /** Responsible organisation unit (prompt §16). */
  responsibleOrgUnitId: string | null;

  /** Workflow Engine instance — the ONLY lifecycle authority (HSE-CORE-006). */
  workflowInstanceId: string | null;

  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A person involved in the HSE event (HSE-CORE-004).
 * `employeeId` is an optional clean reference to the workforce master —
 * no Workforce internals are imported here.
 */
export interface HsePersonInvolved {
  id: string;
  hseRecordId: string;
  employeeId: string | null;
  personName: string | null;
  personRole: string | null;
  createdAt: Date;
}

/**
 * A basic follow-up action (HSE-CORE-007).
 *
 * This is NOT a CAPA entry. There is no root-cause linkage, no effectiveness
 * verification, no action hierarchy. A follow-up has an owner, a due date,
 * and a completion record — that is the complete lifecycle.
 */
export interface HseFollowUp {
  id: string;
  tenantId: string;
  hseRecordId: string;
  title: string;
  description: string | null;
  assignedToUserId: string | null;
  assignedToOrgUnitId: string | null;
  /** Plain `YYYY-MM-DD`. Never via toISOString() — same rule as Workforce/Finance. */
  dueDate: string | null;
  completedAt: Date | null;
  completedByUserId: string | null;
  completionNotes: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CreateHseRecordInput {
  tenantId: string;
  recordNumber: string;
  recordType: HseRecordType;
  categoryCode: string | null;
  severityCode: string | null;
  occurredAt: Date;
  title: string;
  summary: string | null;
  description: string | null;
  immediateAction: string | null;
  organizationUnitId: string | null;
  projectId: string | null;
  siteId: string | null;
  locationDetail: string | null;
  reportedByUserId: string;
  responsibleUserId: string | null;
  responsibleOrgUnitId: string | null;
  createdBy: string | null;
}

export interface UpdateHseRecordInput {
  categoryCode?: string | null;
  severityCode?: string | null;
  occurredAt?: Date;
  title?: string;
  summary?: string | null;
  description?: string | null;
  immediateAction?: string | null;
  organizationUnitId?: string | null;
  projectId?: string | null;
  siteId?: string | null;
  locationDetail?: string | null;
  responsibleUserId?: string | null;
  responsibleOrgUnitId?: string | null;
  updatedBy?: string | null;
}

export interface CreateFollowUpInput {
  tenantId: string;
  hseRecordId: string;
  title: string;
  description: string | null;
  assignedToUserId: string | null;
  assignedToOrgUnitId: string | null;
  dueDate: string | null;
  createdBy: string | null;
}

export interface CompleteFollowUpInput {
  completionNotes: string | null;
  completedBy: string | null;
}

export interface HseRecordListFilter {
  recordType?: HseRecordType;
  categoryCode?: string;
  severityCode?: string;
  organizationUnitId?: string;
  projectId?: string;
  siteId?: string;
  reportedByUserId?: string;
  responsibleUserId?: string;
  occurredFrom?: string;
  occurredTo?: string;
  search?: string;
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

export interface HseRepository {
  // --- HSE records (HSE-CORE-001/002/008) --------------------------------
  createRecord(input: CreateHseRecordInput): Promise<HseRecord>;
  findRecordById(id: string): Promise<HseRecord | null>;
  findRecordByNumber(tenantId: string, recordNumber: string): Promise<HseRecord | null>;
  listRecords(
    tenantId: string,
    filter: HseRecordListFilter,
    orgUnitIds: string[] | null,
  ): Promise<HseRecord[]>;
  updateRecord(
    id: string,
    input: UpdateHseRecordInput,
  ): Promise<HseRecord | null>;
  setRecordWorkflowInstance(id: string, workflowInstanceId: string): Promise<void>;

  // --- Persons involved (HSE-CORE-004) -----------------------------------
  addPersonInvolved(
    hseRecordId: string,
    input: {
      employeeId: string | null;
      personName: string | null;
      personRole: string | null;
    },
  ): Promise<HsePersonInvolved>;
  listPersonsInvolved(hseRecordId: string): Promise<HsePersonInvolved[]>;
  removePersonInvolved(id: string): Promise<void>;

  // --- Follow-ups (HSE-CORE-007) -----------------------------------------
  createFollowUp(input: CreateFollowUpInput): Promise<HseFollowUp>;
  findFollowUpById(id: string): Promise<HseFollowUp | null>;
  listFollowUps(hseRecordId: string): Promise<HseFollowUp[]>;
  /** Idempotent: if already completed, returns existing record unchanged. */
  completeFollowUp(id: string, input: CompleteFollowUpInput): Promise<HseFollowUp | null>;

  // --- Cross-domain reads (clean reference ports) -------------------------
  organizationUnitExists(tenantId: string, id: string): Promise<boolean>;
  projectExists(tenantId: string, id: string): Promise<boolean>;
  siteExists(tenantId: string, id: string): Promise<boolean>;
  userExists(tenantId: string, id: string): Promise<boolean>;
  /** Clean port — only checks existence, imports nothing from Workforce. */
  employeeExists(tenantId: string, employeeId: string): Promise<boolean>;
}
