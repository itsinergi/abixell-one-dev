import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { SurveyService } from "../survey/survey.service.js";
import type { DomainEvent } from "../../domain/event/event.entity.js";
import type { ComplaintRepository } from "../../domain/complaint/complaint.entity.js";
import type { UserRepository } from "../../domain/identity/user.entity.js";
import type {
  CreatePolicyInput,
  SurveyIntegrationExecutionStatus,
  SurveyIntegrationPolicy,
  SurveyIntegrationRepository,
} from "../../domain/survey-integration/survey-integration.entity.js";

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
    private readonly onError: (policyCode: string, error: unknown) => void = () => {},
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
    // Only 'complaint' is a supported source in 1E.1.
    if (sourceEntityType !== "complaint") return null;

    const actorUserId = event.createdBy;
    if (!actorUserId) return null;

    const user = await this.userRepo.findById(actorUserId);
    if (!user || user.tenantId !== event.tenantId) return null;

    const complaint = await this.complaintRepo.findById(sourceEntityId);
    if (!complaint || complaint.tenantId !== event.tenantId) return null;

    const assignments = await this.rbac.getAssignments(actorUserId);
    const isCustomerActor = assignments.some(
      (a) => a.scopeType === "customer" && a.scopeCustomerId === complaint.customerId,
    );
    if (!isCustomerActor) return null;

    return actorUserId;
  }
}
