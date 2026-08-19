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

export interface SurveyIntegrationPolicy {
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

export interface SurveyIntegrationExecution {
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
}

export interface CreatePolicyInput {
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
}
