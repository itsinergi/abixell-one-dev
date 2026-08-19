/**
 * Domain types for the Survey Integration orchestrator (Checkpoint 1E.1).
 *
 * This is the boundary component that turns a business lifecycle event
 * (initially `complaint.customer_confirmed`) into a Survey Assignment,
 * WITHOUT Complaint Core knowing about Survey or Survey Core knowing about
 * Complaint (FD-1E §2/§39). Everything here is generic: a policy points at
 * a `source_entity_type`/`source_event_type` and a `survey_definition_code`
 * — the word "complaint" only appears as a configured finite value, never
 * as Survey/Product Core logic.
 */

/** Finite supported respondent-resolution strategies (FD-1E-02). */
export type RespondentResolution = "source_event_actor";

/** Finite supported target actions (FD-1E-06). Automatic Complaint reopen
 * is NOT part of Phase 1E — it stays a Founder-gated advanced capability. */
export type TargetAction = "management_attention";

/** Finite numeric comparison operators (FD-1E §10). No expressions, no
 * AND/OR trees, no formulas — one policy is exactly one threshold. */
export type OutcomeOperator = "lt" | "lte" | "eq" | "gte" | "gt";

/** Result of evaluating the configured question-code threshold (FD-1E §17). */
export type OutcomeResult = "matched" | "not_matched" | "unresolvable";

/** Why an outcome could not be evaluated — a business/configuration state,
 * never a crash and never a silent fallback to `total_score` (FD-1E §12/§13). */
export type OutcomeErrorCode =
  | "no_outcome_config"
  | "question_not_found"
  | "not_answered"
  | "non_numeric_question"
  | "no_option_score";

/** What happened to the management attention once an outcome matched. */
export type AttentionStatus = "created" | "failed" | "skipped_policy_disabled";

/** The outcome configuration — held by a policy AND snapshotted onto an
 * execution when the Assignment is created, so a later policy edit cannot
 * retroactively change how an already-assigned survey is judged (FD-1E §29). */
export interface OutcomeConfig {
  outcomeQuestionCode: string | null;
  outcomeOperator: OutcomeOperator | null;
  outcomeNumericValue: number | null;
  targetAction: TargetAction | null;
  attentionPermissionCode: string | null;
}

/** Finite execution outcomes (FD-1E §14). Disabled policies produce NO
 * execution row at all (they are filtered out at query time), so there is
 * no `skipped_policy_disabled` status to keep the set lean. */
export type SurveyIntegrationExecutionStatus =
  | "processing"
  | "assigned"
  | "skipped_recipient_unresolvable"
  | "skipped_no_published_version"
  | "skipped_already_assigned"
  | "failed";

export interface SurveyIntegrationPolicy extends OutcomeConfig {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  enabled: boolean;
  sourceEntityType: string;
  sourceEventType: string;
  surveyDefinitionCode: string;
  respondentResolution: RespondentResolution;
  onePerEntityLifetime: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SurveyIntegrationExecution extends OutcomeConfig {
  id: string;
  tenantId: string;
  policyId: string;
  triggerDomainEventId: string;
  sourceEntityType: string;
  sourceEntityId: string;
  surveyAssignmentId: string | null;
  respondentUserId: string | null;
  status: SurveyIntegrationExecutionStatus;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  // Second half (1E.2) — submission → outcome → action.
  submittedDomainEventId: string | null;
  outcome: OutcomeResult | null;
  outcomeValue: number | null;
  outcomeErrorCode: OutcomeErrorCode | null;
  outcomeEvaluatedAt: Date | null;
  attentionStatus: AttentionStatus | null;
  attentionEventId: string | null;
  attentionRecipientCount: number | null;
}

export interface CreatePolicyInput extends Partial<OutcomeConfig> {
  tenantId: string;
  code: string;
  name: string;
  enabled?: boolean;
  sourceEntityType: string;
  sourceEventType: string;
  surveyDefinitionCode: string;
  respondentResolution: RespondentResolution;
  onePerEntityLifetime?: boolean;
  createdBy: string | null;
}

export interface CompleteExecutionInput {
  status: SurveyIntegrationExecutionStatus;
  surveyAssignmentId?: string | null;
  respondentUserId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface SurveyIntegrationRepository {
  createPolicy(input: CreatePolicyInput): Promise<SurveyIntegrationPolicy>;
  findPolicyByCode(tenantId: string, code: string): Promise<SurveyIntegrationPolicy | null>;
  findEnabledPolicies(
    tenantId: string,
    sourceEntityType: string,
    sourceEventType: string,
  ): Promise<SurveyIntegrationPolicy[]>;

  /** Claim a (policy, trigger event) slot by inserting a `processing`
   * execution. Returns `{ duplicate: true }` (and no execution) when a row
   * for that pair already exists — i.e. the event is being reprocessed and
   * must be a safe no-op (DB is the final idempotency boundary). */
  startExecution(input: {
    tenantId: string;
    policyId: string;
    triggerDomainEventId: string;
    sourceEntityType: string;
    sourceEntityId: string;
    /** Snapshot of the policy's outcome configuration at assignment time
     * (FD-1E §29) — evaluation later reads THIS, not the live policy. */
    outcomeConfig: OutcomeConfig;
  }): Promise<{ execution: SurveyIntegrationExecution | null; duplicate: boolean }>;

  /** The existing `assigned` execution for this (policy, source entity), if
   * any — the application-side pre-check for one-per-lifetime (the partial
   * unique index is the authoritative guard). */
  findAssignedLifetimeExecution(
    policyId: string,
    sourceEntityType: string,
    sourceEntityId: string,
  ): Promise<SurveyIntegrationExecution | null>;

  /** Finalize an execution. Returns `{ lifetimeConflict: true }` when
   * moving to `assigned` violates the partial unique index (another
   * execution already assigned for this source entity) — a race the caller
   * resolves by re-completing as `skipped_already_assigned`. */
  completeExecution(
    id: string,
    input: CompleteExecutionInput,
  ): Promise<{ lifetimeConflict: boolean }>;

  findExecutionById(id: string): Promise<SurveyIntegrationExecution | null>;

  findPolicyById(id: string): Promise<SurveyIntegrationPolicy | null>;

  /** The `assigned` execution that created this Survey Assignment — the
   * 1E.1 lineage a submission is evaluated against (FD-1E §24/§28). Null
   * when the Assignment was created manually (not by integration), which
   * makes a manual assignment's submission a safe no-op. */
  findAssignedExecutionByAssignment(
    surveyAssignmentId: string,
  ): Promise<SurveyIntegrationExecution | null>;

  /** Exactly-once claim for the outcome half: a single conditional UPDATE
   * (`WHERE outcome IS NULL`) — a replayed `survey.submitted` loses the
   * compare-and-set and returns null, so no second action is taken
   * (FD-1E §25/§26). */
  claimOutcome(
    executionId: string,
    input: {
      submittedDomainEventId: string;
      outcome: OutcomeResult;
      outcomeValue: number | null;
      outcomeErrorCode: OutcomeErrorCode | null;
    },
  ): Promise<SurveyIntegrationExecution | null>;

  recordAttention(
    executionId: string,
    input: {
      attentionStatus: AttentionStatus;
      attentionEventId: string | null;
      attentionRecipientCount: number | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    },
  ): Promise<void>;
}
