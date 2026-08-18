import type {
  Complaint,
  ComplaintRepository,
  UpdateInvestigationInput,
} from "../../domain/complaint/complaint.entity.js";
import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { CustomerService } from "../customer/customer.service.js";
import type { WorkflowService } from "../workflow/workflow.service.js";
import type { ConfigurationService } from "../configuration/configuration.service.js";
import type { EventBus } from "../event/event-bus.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../domain/shared-kernel/errors.js";

/** Product Core integration point: the Workflow Definition code every
 * Complaint's lifecycle runs against. The DEFINITION's actual Steps/
 * Transitions/SLA/Assignment Rules are 100% Tenant-configurable through
 * the existing Workflow Engine admin API (`/workflow/definitions/...`)
 * — this constant only fixes WHICH configurable graph a Complaint uses,
 * the same kind of fixed integration point `entityType='complaint'`
 * already is. Not a hardcoded lifecycle — see decision-log.md. */
export const COMPLAINT_WORKFLOW_DEFINITION_CODE = "complaint_lifecycle";
export const COMPLAINT_NUMBERING_CODE = "complaint_number";

/** actionCode -> business-readable Domain Event type (Event Catalog,
 * doc section 33). A Tenant is free to configure Transitions with ANY
 * actionCode; one outside this map still works end-to-end, it just
 * publishes the generic `complaint.status_changed` event instead of a
 * named one — never a hard failure. */
const ACTION_EVENT_MAP: Record<string, string> = {
  submit: "complaint.submitted",
  acknowledge: "complaint.acknowledged",
  assign: "complaint.assigned",
  start_investigation: "complaint.investigation_started",
  submit_corrective_action: "complaint.corrective_action_submitted",
  submit_for_verification: "complaint.verification_requested",
  verify: "complaint.verified",
  confirm: "complaint.customer_confirmed",
  close: "complaint.closed",
  reject: "complaint.rejected",
  cancel: "complaint.cancelled",
};

export interface CreateComplaintInput {
  customerId: string;
  customerContactId?: string | null;
  contractId?: string | null;
  projectId?: string | null;
  siteId?: string | null;
  serviceId?: string | null;
  category: string;
  subcategory?: string | null;
  description: string;
  priority: string;
  severity: string;
  source?: string | null;
  channel?: string | null;
}

/**
 * Generic Customer Complaint Engine (Checkpoint 1B). Deliberately thin —
 * every lifecycle/assignment/SLA concern is delegated to the generic
 * Workflow Engine (0D/0E); this class's job is Complaint-specific
 * authorization (Customer Data Scope, ADR-0011) and Complaint-specific
 * data (category/priority/severity/investigation/evidence context),
 * never re-implementing state machine logic.
 */
export class ComplaintService {
  constructor(
    private readonly repo: ComplaintRepository,
    private readonly customers: CustomerService,
    private readonly workflow: WorkflowService,
    private readonly configuration: ConfigurationService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly eventBus: EventBus,
  ) {}

  async create(actor: ActorContext, input: CreateComplaintInput): Promise<Complaint> {
    await this.rbac.requirePermission(actor.userId, "complaint.manage");
    // Customer/Data Scope Validation — the E2E target's second step.
    // Works identically whether `actor` is a Customer User (scope_type
    // 'customer', exact match, ADR-0011) or an internal user filing on a
    // Customer's behalf (organization_unit scope, hierarchical, ADR-0009).
    const customer = await this.customers.getAuthorized(actor, input.customerId);

    const { number } = await this.configuration.generateNumberForTenant(
      actor.tenantId,
      COMPLAINT_NUMBERING_CODE,
      actor.userId,
    );

    const complaint = await this.repo.create(
      { ...input, tenantId: actor.tenantId, complaintNumber: number, submittedByUserId: actor.userId },
      actor.userId,
    );

    // Starts the Workflow Instance at its configured initial Step
    // (Draft, in the demo Workflow Definition — Tenant-configurable,
    // never hardcoded here). `organizationUnitId` in contextData is what
    // lets a `submitter_unit` Assignment/Escalation Rule route to the
    // Customer's own internal owning team (ADR-0011's convergence point)
    // without Complaint Service knowing anything about routing itself.
    const { instance } = await this.workflow.startInstance(actor, {
      definitionCode: COMPLAINT_WORKFLOW_DEFINITION_CODE,
      entityId: complaint.id,
      contextData: {
        customerId: customer.id,
        organizationUnitId: customer.ownerOrganizationUnitId,
        category: input.category,
        subcategory: input.subcategory ?? null,
        priority: input.priority,
        severity: input.severity,
      },
    });
    await this.repo.setWorkflowInstance(complaint.id, instance.id);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "complaint.created",
      entityType: "complaint",
      entityId: complaint.id,
      metadata: { complaintNumber: number, customerId: customer.id, category: input.category, priority: input.priority, severity: input.severity },
    });
    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: "complaint.created",
      entityType: "complaint",
      entityId: complaint.id,
      payload: { complaintNumber: number, customerId: customer.id, targetUserId: actor.userId },
      createdBy: actor.userId,
    });

    return { ...complaint, workflowInstanceId: instance.id };
  }

  async get(actor: ActorContext, id: string): Promise<{
    complaint: Complaint;
    status: { stepCode: string | null; instanceStatus: string } | null;
  }> {
    await this.rbac.requirePermission(actor.userId, "complaint.read");
    const complaint = await this.getAuthorized(actor, id);
    if (!complaint.workflowInstanceId) {
      return { complaint, status: null };
    }
    const { instance, currentStep } = await this.workflow.getInstanceForEntityOwner(
      actor.tenantId,
      complaint.workflowInstanceId,
    );
    return { complaint, status: { stepCode: currentStep?.code ?? null, instanceStatus: instance.status } };
  }

  async listByCustomer(actor: ActorContext, customerId: string): Promise<Complaint[]> {
    await this.rbac.requirePermission(actor.userId, "complaint.read");
    await this.customers.getAuthorized(actor, customerId);
    return this.repo.listByCustomer(customerId);
  }

  /** Submit is just the first Transition (Draft -> Submitted) — no
   * special-cased code path, goes through the exact same generic
   * `act()` machinery as every other action. Kept as a named method only
   * because the Phase 1 instruction calls it out as its own E2E step. */
  async submit(actor: ActorContext, id: string, comment: string | null) {
    return this.act(actor, id, "submit", comment);
  }

  /**
   * Generic action dispatch — wraps `WorkflowService.actOnAssignment`.
   * Complaint Service does NOT know the Step graph; it finds whatever
   * pending Assignment currently exists on the Complaint's Workflow
   * Instance and forwards `actionCode` verbatim. An invalid
   * transition (wrong actionCode for the current Step, or a Condition
   * that doesn't match) is rejected by the Workflow Engine itself
   * (`ValidationError`), not by anything here — this is the literal
   * meaning of "Workflow tidak boleh hardcoded di Complaint Service".
   */
  async act(actor: ActorContext, id: string, actionCode: string, comment: string | null) {
    await this.rbac.requirePermission(actor.userId, "complaint.manage");
    const complaint = await this.getAuthorized(actor, id);
    if (!complaint.workflowInstanceId) {
      throw new ConflictError("This Complaint has no active Workflow Instance");
    }

    const { assignments } = await this.workflow.getInstanceForEntityOwner(
      actor.tenantId,
      complaint.workflowInstanceId,
    );
    const pending = assignments.find((a) => a.status === "pending");
    if (!pending) {
      throw new ConflictError("No pending action currently exists on this Complaint");
    }

    // `actOnAssignment` re-validates eligibility itself (role+scope or
    // specific_user match) — the `getAuthorized` call above is Complaint
    // VISIBILITY (Customer Data Scope OR workflow association), a
    // strictly broader net than "can act right now", by design (see
    // `getAuthorized` doc comment).
    const result = await this.workflow.actOnAssignment(actor, pending.id, actionCode, comment);

    if (actionCode === "submit") {
      await this.repo.markSubmitted(id, new Date());
    }
    if (result.instance.status !== "in_progress") {
      await this.repo.markClosed(id, new Date());
    }

    const eventType = ACTION_EVENT_MAP[actionCode] ?? "complaint.status_changed";
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: eventType,
      entityType: "complaint",
      entityId: id,
      metadata: { actionCode, comment },
    });
    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType,
      entityType: "complaint",
      entityId: id,
      payload: { complaintNumber: complaint.complaintNumber, actionCode, targetUserId: complaint.submittedByUserId, comment },
      createdBy: actor.userId,
    });

    return { complaint: (await this.repo.findById(id))!, workflowResult: result };
  }

  async updateInvestigation(actor: ActorContext, id: string, input: UpdateInvestigationInput) {
    await this.rbac.requirePermission(actor.userId, "complaint.manage");
    await this.getAuthorized(actor, id);
    const updated = await this.repo.updateInvestigation(id, input, actor.userId);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "complaint.investigation_updated",
      entityType: "complaint",
      entityId: id,
      metadata: { ...input },
    });

    return updated;
  }

  async verify(actor: ActorContext, id: string, verificationNote: string | null) {
    await this.rbac.requirePermission(actor.userId, "complaint.manage");
    await this.getAuthorized(actor, id);
    const updated = await this.repo.updateVerification(
      id,
      { verificationNote, verifiedByUserId: actor.userId },
      actor.userId,
    );
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "complaint.verified",
      entityType: "complaint",
      entityId: id,
      metadata: { verificationNote },
    });
    return updated;
  }

  async confirmByCustomer(actor: ActorContext, id: string, note: string | null) {
    await this.rbac.requirePermission(actor.userId, "complaint.manage");
    await this.getAuthorized(actor, id);
    const updated = await this.repo.updateCustomerConfirmation(
      id,
      { customerConfirmationNote: note },
      actor.userId,
    );
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "complaint.customer_confirmation_recorded",
      entityType: "complaint",
      entityId: id,
      metadata: { note },
    });
    return updated;
  }

  /**
   * Reopen — the one Complaint action that CANNOT go through `act()`
   * (a completed Instance has no pending Assignment to act on, see
   * `WorkflowService.reopenInstance`'s doc comment). Complaint-specific
   * authorization happens HERE (permission + Customer Data Scope +
   * "must actually be closed"); the generic reopen mechanics are 100%
   * `WorkflowService`'s, reused as-is.
   */
  async reopen(actor: ActorContext, id: string, toStepCode: string, comment: string | null) {
    await this.rbac.requirePermission(actor.userId, "complaint.manage");
    const complaint = await this.getAuthorized(actor, id);
    if (!complaint.workflowInstanceId) {
      throw new ConflictError("This Complaint has no active Workflow Instance");
    }

    const { instance } = await this.workflow.getInstanceForEntityOwner(
      actor.tenantId,
      complaint.workflowInstanceId,
    );
    if (instance.status === "in_progress") {
      throw new ConflictError("Only a Closed/Rejected/Cancelled Complaint can be reopened");
    }

    const result = await this.workflow.reopenInstance(actor, complaint.workflowInstanceId, {
      toStepCode,
      comment,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "complaint.reopened",
      entityType: "complaint",
      entityId: id,
      metadata: { toStepCode, comment },
    });
    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: "complaint.reopened",
      entityType: "complaint",
      entityId: id,
      payload: { complaintNumber: complaint.complaintNumber, targetUserId: complaint.submittedByUserId, comment },
      createdBy: actor.userId,
    });

    return { complaint: (await this.repo.findById(id))!, workflowResult: result };
  }

  /**
   * Complaint visibility gate — Customer Data Scope (ADR-0011, via
   * `CustomerService.canAccessForDocument`, deliberately the
   * permission-free scope-only check) OR the actor is associated with
   * the Complaint's Workflow Instance (started it, or currently/
   * previously assigned — `WorkflowService.isActorAssociatedWithInstance`).
   * The second path matters because an internal investigator's Role+
   * Organization-Unit Assignment routing is independent of the
   * Customer's own `ownerOrganizationUnitId` (e.g. a central
   * investigation team serving every Customer) — Customer Data Scope
   * alone would wrongly block a legitimately assigned investigator.
   * `WorkflowService.actOnAssignment`'s own `assertEligible` remains the
   * PRECISE gate for whether a given action is allowed right now; this
   * method only answers "may this actor know the Complaint exists".
   */
  async getAuthorized(actor: ActorContext, id: string): Promise<Complaint> {
    const complaint = await this.repo.findById(id);
    if (!complaint || complaint.tenantId !== actor.tenantId) {
      throw new NotFoundError("Complaint", id);
    }
    if (await this.customers.canAccessForDocument(actor, complaint.customerId)) {
      return complaint;
    }
    if (complaint.submittedByUserId === actor.userId) {
      return complaint;
    }
    if (
      complaint.workflowInstanceId &&
      (await this.workflow.isActorAssociatedWithInstance(actor, complaint.workflowInstanceId))
    ) {
      return complaint;
    }
    throw new ForbiddenError("Your Data Scope does not cover this Complaint");
  }

  /** Entity Authorization Resolver for `entityType='complaint'`
   * (ADR-0012 pattern, reused from 1A's `customer` resolver). Data-Scope-
   * only, no separate `document.*`/`complaint.*` permission required —
   * same binding decision as Customer's attachments. */
  async canAccessForDocument(actor: ActorContext, complaintId: string): Promise<boolean> {
    try {
      await this.getAuthorized(actor, complaintId);
      return true;
    } catch {
      return false;
    }
  }
}
