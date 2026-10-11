import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { SurveyService } from "../survey/survey.service.js";
import type { DomainEvent } from "../../domain/event/event.entity.js";
import type { ComplaintRepository } from "../../domain/complaint/complaint.entity.js";
import type { UserRepository } from "../../domain/identity/user.entity.js";
import type { EventBus } from "../event/event-bus.js";
import type { RbacRepository } from "../../domain/rbac/rbac.entity.js";
import type {
  OutcomeConfig,
  OutcomeErrorCode,
  OutcomeOperator,
  OutcomeResult,
  CreatePolicyInput,
  SurveyIntegrationExecution,
  SurveyIntegrationExecutionStatus,
  SurveyIntegrationPolicy,
  SurveyIntegrationRepository,
} from "../../domain/survey-integration/survey-integration.entity.js";

/**
 * WP-OPS-01 Phase 6 — narrow read port for the `work_order` source entity.
 * Structurally satisfied by the Service Operations repository; declared here
 * so this application component never imports a module's own types (same
 * one-way rule as the Complaint dependency above).
 */
export interface WorkOrderCustomerLookupPort {
  findWorkOrderById(id: string): Promise<{ tenantId: string; customerId: string } | null>;
}

/**
 * Survey Integration orchestrator (Checkpoint 1E.1).
 *
 * Wired in the composition root as an EventBus subscriber to
 * `complaint.customer_confirmed`. It resolves the matching integration
 * policies, resolves an authenticated CUSTOMER-side respondent, resolves the
 * survey's current published version, and creates a Survey Assignment
 * EXACTLY ONCE — recording a durable execution row for idempotency +
 * observability at every step.
 *
 * Boundary rules (FD-1E §2/§39): this component depends on Complaint (read)
 * and Survey (application port) — one-way. Complaint Core and Survey Core
 * never depend on each other or on this component. The strings "complaint"
 * / "complaint.customer_confirmed" live here as configured finite policy
 * values, never inside Survey/Product Core.
 *
 * Reliability (FD-1E §15/§16): the in-process EventBus is fire-once and
 * SWALLOWS a throwing subscriber (a failed integration must never roll back
 * the customer's confirmation). Therefore this handler NEVER throws — it
 * catches everything and persists a `failed` execution so the failure is
 * durable and observable rather than lost in the swallowed exception.
 */
export class SurveyIntegrationService {
  constructor(
    private readonly repo: SurveyIntegrationRepository,
    private readonly survey: SurveyService,
    private readonly complaintRepo: ComplaintRepository,
    private readonly userRepo: UserRepository,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly rbacRepo: RbacRepository,
    private readonly eventBus: EventBus,
    private readonly onError: (policyCode: string, error: unknown) => void = () => {},
    private readonly workOrders: WorkOrderCustomerLookupPort | null = null,
  ) {}

  /** Config seam (seed / test / future admin). No human-permission gate is
   * exposed yet (no admin surface in 1E.1, so no dead `survey.integration.
   * configure` permission — FD-1E §20). Callers are trusted bootstrap. */
  async createPolicy(input: CreatePolicyInput): Promise<SurveyIntegrationPolicy> {
    return this.repo.createPolicy(input);
  }

  /** EventBus subscriber entry point. */
  async handleTriggerEvent(event: DomainEvent): Promise<void> {
    if (!event.entityId) return;
    const sourceEntityType = event.entityType;
    const sourceEventType = event.eventType;
    const sourceEntityId = event.entityId;

    const policies = await this.repo.findEnabledPolicies(
      event.tenantId,
      sourceEntityType,
      sourceEventType,
    );
    if (policies.length === 0) return;

    await this.audit.record({
      tenantId: event.tenantId,
      actorUserId: null,
      action: "survey.integration.trigger.received",
      entityType: "domain_event",
      entityId: event.id,
      metadata: { sourceEntityType, sourceEventType, policiesMatched: policies.length },
    });

    for (const policy of policies) {
      await this.runPolicy(policy, event, sourceEntityType, sourceEntityId);
    }
  }

  private async runPolicy(
    policy: SurveyIntegrationPolicy,
    event: DomainEvent,
    sourceEntityType: string,
    sourceEntityId: string,
  ): Promise<void> {
    const started = await this.repo.startExecution({
      tenantId: event.tenantId,
      policyId: policy.id,
      triggerDomainEventId: event.id,
      sourceEntityType,
      sourceEntityId,
      // FD-1E §29 — snapshot the outcome configuration NOW, so editing the
      // policy while the respondent is still answering cannot retroactively
      // change how this assignment is judged.
      outcomeConfig: {
        outcomeQuestionCode: policy.outcomeQuestionCode,
        outcomeOperator: policy.outcomeOperator,
        outcomeNumericValue: policy.outcomeNumericValue,
        targetAction: policy.targetAction,
        attentionPermissionCode: policy.attentionPermissionCode,
      },
    });
    // Reprocessed event (same policy + same domain event) — safe no-op.
    if (started.duplicate || !started.execution) return;
    const execId = started.execution.id;

    try {
      // One-per-lifetime pre-check (the partial unique index is the
      // authoritative guard; this avoids creating an orphan assignment in
      // the common case).
      if (policy.onePerEntityLifetime) {
        const existing = await this.repo.findAssignedLifetimeExecution(
          policy.id,
          sourceEntityType,
          sourceEntityId,
        );
        if (existing) {
          await this.skip(policy, event, execId, "skipped_already_assigned", null);
          return;
        }
      }

      // Respondent resolution (FD-1E-02).
      const respondentUserId = await this.resolveRespondent(
        policy,
        event,
        sourceEntityType,
        sourceEntityId,
      );
      if (!respondentUserId) {
        await this.skip(policy, event, execId, "skipped_recipient_unresolvable", null);
        return;
      }

      // Survey version resolution (FD-1E-04) — null = definition missing or
      // no current published version; skip without failing confirmation.
      const version = await this.survey.resolvePublishedVersionForTrustedIntegration(
        event.tenantId,
        policy.surveyDefinitionCode,
      );
      if (!version) {
        await this.skip(policy, event, execId, "skipped_no_published_version", respondentUserId);
        return;
      }

      // Create the assignment via the trusted seam.
      const assignment = await this.survey.createAssignmentForTrustedIntegration({
        tenantId: event.tenantId,
        surveyVersionId: version.id,
        respondentUserId,
        contextEntityType: sourceEntityType,
        contextEntityId: sourceEntityId,
        automationTriggerEventId: event.id,
      });

      const done = await this.repo.completeExecution(execId, {
        status: "assigned",
        surveyAssignmentId: assignment.id,
        respondentUserId,
      });
      if (done.lifetimeConflict) {
        // Rare race: a concurrent execution assigned first. Record this one
        // as skipped; the just-created assignment is a documented orphan
        // under the synchronous best-effort model (FD-1E §16/§30).
        await this.repo.completeExecution(execId, {
          status: "skipped_already_assigned",
          respondentUserId,
        });
        await this.audit.record({
          tenantId: event.tenantId,
          actorUserId: null,
          action: "survey.integration.skipped",
          entityType: "survey_integration_execution",
          entityId: execId,
          metadata: {
            policyId: policy.id,
            reason: "skipped_already_assigned",
            detail: "lifetime_race",
            orphanSurveyAssignmentId: assignment.id,
            triggerDomainEventId: event.id,
          },
        });
        return;
      }

      await this.audit.record({
        tenantId: event.tenantId,
        actorUserId: null,
        action: "survey.integration.assignment.created",
        entityType: "survey_assignment",
        entityId: assignment.id,
        metadata: {
          policyId: policy.id,
          executionId: execId,
          respondentUserId,
          sourceEntityType,
          sourceEntityId,
          triggerDomainEventId: event.id,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : null;
      try {
        await this.repo.completeExecution(execId, {
          status: "failed",
          errorCode: code,
          errorMessage: message.slice(0, 500),
        });
        await this.audit.record({
          tenantId: event.tenantId,
          actorUserId: null,
          action: "survey.integration.failed",
          entityType: "survey_integration_execution",
          entityId: execId,
          metadata: { policyId: policy.id, errorCode: code, triggerDomainEventId: event.id },
        });
      } catch (persistError) {
        this.onError(policy.code, persistError);
      }
      // NEVER rethrow — the EventBus would swallow it anyway and the
      // customer's confirmation must not roll back (FD-1E §15).
      this.onError(policy.code, error);
    }
  }

  private async skip(
    policy: SurveyIntegrationPolicy,
    event: DomainEvent,
    execId: string,
    status: SurveyIntegrationExecutionStatus,
    respondentUserId: string | null,
  ): Promise<void> {
    await this.repo.completeExecution(execId, { status, respondentUserId });
    await this.audit.record({
      tenantId: event.tenantId,
      actorUserId: null,
      action: "survey.integration.skipped",
      entityType: "survey_integration_execution",
      entityId: execId,
      metadata: { policyId: policy.id, reason: status, triggerDomainEventId: event.id },
    });
  }

  /**
   * FD-1E-02 — the respondent is the SOURCE EVENT ACTOR (`event.createdBy`),
   * accepted only when it is a genuine customer-side actor for this source
   * entity. Validates: (1) key present, (2) user exists & same tenant,
   * (3) source entity readable & same tenant, (4) the user holds a
   * `customer`-scoped role assignment matching the source entity's Customer
   * — which structurally EXCLUDES internal handlers/admins (they carry
   * `tenant`/`organization_unit` scope, not a matching `customer` scope).
   * Returns null (→ skipped_recipient_unresolvable) on any failure; never
   * falls back to submittedByUserId / an internal agent / a contact / the
   * first customer user / admin / an anonymous token.
   */
  private async resolveRespondent(
    policy: SurveyIntegrationPolicy,
    event: DomainEvent,
    sourceEntityType: string,
    sourceEntityId: string,
  ): Promise<string | null> {
    if (policy.respondentResolution !== "source_event_actor") return null;

    // Public-token acceptance (WP-OPS-01 Phase 6) carries no actor → the
    // execution is recorded as skipped_recipient_unresolvable, never failed.
    const actorUserId = event.createdBy;
    if (!actorUserId) return null;

    const user = await this.userRepo.findById(actorUserId);
    if (!user || user.tenantId !== event.tenantId) return null;

    const customerId = await this.resolveSourceCustomerId(event, sourceEntityType, sourceEntityId);
    if (!customerId) return null;

    const assignments = await this.rbac.getAssignments(actorUserId);
    const isCustomerActor = assignments.some(
      (a) => a.scopeType === "customer" && a.scopeCustomerId === customerId,
    );
    if (!isCustomerActor) return null;

    return actorUserId;
  }

  /** Supported sources: `complaint` (1E.1) and `work_order` (WP-OPS-01
   * Phase 6). Returns the owning Customer id, or null when the source is
   * unsupported, missing, or belongs to another tenant. */
  private async resolveSourceCustomerId(
    event: DomainEvent,
    sourceEntityType: string,
    sourceEntityId: string,
  ): Promise<string | null> {
    if (sourceEntityType === "complaint") {
      const complaint = await this.complaintRepo.findById(sourceEntityId);
      if (!complaint || complaint.tenantId !== event.tenantId) return null;
      return complaint.customerId;
    }
    if (sourceEntityType === "work_order" && this.workOrders) {
      const workOrder = await this.workOrders.findWorkOrderById(sourceEntityId);
      if (!workOrder || workOrder.tenantId !== event.tenantId) return null;
      return workOrder.customerId;
    }
    return null;
  }

  // =====================================================================
  // Checkpoint 1E.2 — survey.submitted → outcome → management attention
  // =====================================================================

  /**
   * EventBus subscriber for `survey.submitted`. Like the trigger handler it
   * NEVER throws: a Survey submission is a completed domain action and must
   * never be rolled back because a side-effect failed (FD-1E §34).
   *
   * The submission is evaluated against the execution created in 1E.1 for
   * this assignment (policy lineage, FD-1E §28) using that execution's
   * SNAPSHOT of the outcome configuration (FD-1E §29). An assignment that
   * integration did not create has no execution → safe no-op.
   */
  async handleSurveySubmitted(event: DomainEvent): Promise<void> {
    if (!event.entityId) return;
    const assignmentId = event.entityId;
    let execution: SurveyIntegrationExecution | null = null;

    try {
      execution = await this.repo.findAssignedExecutionByAssignment(assignmentId);
      if (!execution) return; // manually created assignment — not ours.
      if (execution.tenantId !== event.tenantId) return; // tenant safety.

      const evaluation = await this.evaluateOutcome(execution, assignmentId);

      // Exactly-once claim (FD-1E §25/§26): a replayed submission loses the
      // compare-and-set and performs no second action.
      const claimed = await this.repo.claimOutcome(execution.id, {
        submittedDomainEventId: event.id,
        outcome: evaluation.outcome,
        outcomeValue: evaluation.value,
        outcomeErrorCode: evaluation.errorCode,
      });
      if (!claimed) return;

      await this.audit.record({
        tenantId: execution.tenantId,
        actorUserId: null,
        action: "survey.integration.outcome.evaluated",
        entityType: "survey_integration_execution",
        entityId: execution.id,
        metadata: {
          policyId: execution.policyId,
          surveyAssignmentId: assignmentId,
          questionCode: execution.outcomeQuestionCode,
          operator: execution.outcomeOperator,
          threshold: execution.outcomeNumericValue,
          outcome: evaluation.outcome,
          value: evaluation.value,
          outcomeErrorCode: evaluation.errorCode,
          submittedDomainEventId: event.id,
        },
      });

      if (evaluation.outcome !== "matched") return;
      if (execution.targetAction !== "management_attention") return;

      // A policy disabled after the assignment must not act (FD-1E §58).
      const policy = await this.repo.findPolicyById(execution.policyId);
      if (!policy || !policy.enabled) {
        await this.repo.recordAttention(execution.id, {
          attentionStatus: "skipped_policy_disabled",
          attentionEventId: null,
          attentionRecipientCount: null,
        });
        return;
      }

      await this.createManagementAttention(execution, assignmentId, evaluation.value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (execution) {
        try {
          await this.repo.recordAttention(execution.id, {
            attentionStatus: "failed",
            attentionEventId: null,
            attentionRecipientCount: null,
            errorCode: "outcome_processing_error",
            errorMessage: message.slice(0, 500),
          });
          await this.audit.record({
            tenantId: execution.tenantId,
            actorUserId: null,
            action: "survey.integration.attention.failed",
            entityType: "survey_integration_execution",
            entityId: execution.id,
            metadata: { errorCode: "outcome_processing_error", surveyAssignmentId: assignmentId },
          });
        } catch (persistError) {
          this.onError("survey.submitted", persistError);
        }
      }
      this.onError("survey.submitted", error);
    }
  }

  /**
   * Management Attention (FD-1E-06). Recipients are resolved by CAPABILITY
   * (the snapshotted permission code), never by role name, and never
   * include Customer Users (`listUserIdsWithPermissionInTenant` excludes
   * customer-scoped assignments). Delivery reuses the existing Notification
   * Engine: one domain event carrying `targetUserIds` — no new task/queue
   * subsystem, no duplicate mirror event.
   */
  private async createManagementAttention(
    execution: SurveyIntegrationExecution,
    assignmentId: string,
    value: number | null,
  ): Promise<void> {
    const permissionCode = execution.attentionPermissionCode;
    const recipients = permissionCode
      ? await this.rbacRepo.listUserIdsWithPermissionInTenant(execution.tenantId, permissionCode)
      : [];

    if (recipients.length === 0) {
      await this.repo.recordAttention(execution.id, {
        attentionStatus: "failed",
        attentionEventId: null,
        attentionRecipientCount: 0,
        errorCode: "no_management_recipient",
        errorMessage: `No internal user holds '${permissionCode ?? "(unconfigured)"}' in this tenant`,
      });
      await this.audit.record({
        tenantId: execution.tenantId,
        actorUserId: null,
        action: "survey.integration.attention.failed",
        entityType: "survey_integration_execution",
        entityId: execution.id,
        metadata: { reason: "no_management_recipient", attentionPermissionCode: permissionCode },
      });
      return;
    }

    // Deliberately carries the threshold context (why attention is needed),
    // NOT the respondent's free-text answers (FD-1E §22).
    const attentionEvent = await this.eventBus.publish({
      tenantId: execution.tenantId,
      eventType: "survey.integration.attention_required",
      entityType: "survey_integration_execution",
      entityId: execution.id,
      payload: {
        targetUserIds: recipients,
        surveyAssignmentId: assignmentId,
        contextEntityType: execution.sourceEntityType,
        contextEntityId: execution.sourceEntityId,
        respondentUserId: execution.respondentUserId,
        questionCode: execution.outcomeQuestionCode,
        operator: execution.outcomeOperator,
        threshold: execution.outcomeNumericValue,
        value,
      },
      createdBy: null,
    });

    await this.repo.recordAttention(execution.id, {
      attentionStatus: "created",
      attentionEventId: attentionEvent.id,
      attentionRecipientCount: recipients.length,
    });
    await this.audit.record({
      tenantId: execution.tenantId,
      actorUserId: null,
      action: "survey.integration.attention.created",
      entityType: "survey_integration_execution",
      entityId: execution.id,
      metadata: {
        policyId: execution.policyId,
        surveyAssignmentId: assignmentId,
        recipientCount: recipients.length,
        attentionPermissionCode: permissionCode,
        value,
      },
    });
  }

  /**
   * Question-code numeric threshold evaluation (FD-1E-05).
   *  - `rating`        → the submitted numeric value, no normalization.
   *  - `single_choice` → the selected option's CONFIGURED score (never the
   *                      option's order/index).
   *  - anything else / unanswered / option without a score → unresolvable.
   * Never falls back to `total_score` and never invents a number
   * (FD-1E §13/§16).
   */
  private async evaluateOutcome(
    execution: SurveyIntegrationExecution,
    assignmentId: string,
  ): Promise<{ outcome: OutcomeResult; value: number | null; errorCode: OutcomeErrorCode | null }> {
    const unresolvable = (errorCode: OutcomeErrorCode) =>
      ({ outcome: "unresolvable" as const, value: null, errorCode });

    const config: OutcomeConfig = execution;
    if (
      !config.outcomeQuestionCode ||
      !config.outcomeOperator ||
      config.outcomeNumericValue === null ||
      !config.targetAction
    ) {
      // Includes executions created before 1E.2 (no snapshot) — FD-1E §49.
      return unresolvable("no_outcome_config");
    }

    // Trusted read: tenant + submitted state enforced inside (FD-1E §43).
    const result = await this.survey.getResultForTrustedIntegration(execution.tenantId, assignmentId);
    if (!result) return unresolvable("not_answered");

    const question = result.questions.find((q) => q.code === config.outcomeQuestionCode);
    if (!question) return unresolvable("question_not_found");

    const answer = result.answers.find((a) => a.surveyQuestionId === question.id);
    if (!answer) return unresolvable("not_answered");

    let value: number | null = null;
    if (question.questionType === "rating") {
      value = answer.valueNumeric;
      if (value === null) return unresolvable("not_answered");
    } else if (question.questionType === "single_choice") {
      const selectedIds = result.selectedOptionIdsByAnswerId.get(answer.id) ?? [];
      if (selectedIds.length === 0) return unresolvable("not_answered");
      const options = result.optionsByQuestionId.get(question.id) ?? [];
      const selected = options.find((o) => o.id === selectedIds[0]);
      if (!selected || selected.score === null || selected.score === undefined) {
        return unresolvable("no_option_score");
      }
      value = selected.score;
    } else {
      return unresolvable("non_numeric_question");
    }

    const matched = compare(value, config.outcomeOperator, config.outcomeNumericValue);
    return { outcome: matched ? "matched" : "not_matched", value, errorCode: null };
  }
}

/** Finite numeric comparison — no expressions, no DSL (FD-1E §10). */
function compare(value: number, operator: OutcomeOperator, threshold: number): boolean {
  switch (operator) {
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
    case "eq":
      return value === threshold;
    case "gte":
      return value >= threshold;
    case "gt":
      return value > threshold;
    default:
      return false;
  }
}
