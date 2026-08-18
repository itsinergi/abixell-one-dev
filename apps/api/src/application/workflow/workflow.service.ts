import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../domain/shared-kernel/errors.js";
import type {
  ConditionExpression,
  OrganizationUnitStrategy,
  SpecificUserSource,
  WorkflowAssignmentType,
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowInstanceAssignment,
  WorkflowRepository,
  WorkflowStepType,
  WorkflowTerminalStatus,
  WorkflowVersion,
} from "../../domain/workflow/workflow.entity.js";
import { evaluateCondition } from "./condition-evaluator.js";

/**
 * Application-layer orchestration for the Workflow & Approval Engine
 * (Checkpoint 0D), per 04-Workflow-Approval-Engine-Foundation.md.
 *
 * Two halves:
 *  - Design-time: authoring a Workflow Definition/Version/Step/
 *    Transition/Assignment Rule/Escalation Rule, then publishing a
 *    version. Gated by `workflow.definition.manage`/`.read`.
 *  - Runtime: starting a Workflow Instance against a generic object,
 *    resolving Assignment (Condition-driven dynamic routing), acting on
 *    an Assignment (Approve/Reject/Return/Resubmit), and the Escalation
 *    sweep. Gated by `workflow.instance.*`.
 *
 * Every mutating operation calls AuditService (cross-cutting Audit Trail,
 * per doc 02/06) IN ADDITION to `workflow_history` (the domain-specific
 * full journey of one instance, per doc 04's "History" component) — the
 * two serve different audiences: Audit Trail is "what changed, who did
 * it, when", workflow_history is "how did this specific transaction get
 * from Submit to Complete".
 */
export class WorkflowService {
  constructor(
    private readonly repo: WorkflowRepository,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  // ======================================================================
  // Design-time
  // ======================================================================

  async createDefinition(
    actor: ActorContext,
    input: { code: string; name: string; entityType: string; description: string },
  ) {
    await this.rbac.requirePermission(actor.userId, "workflow.definition.manage");
    const definition = await this.repo.createDefinition({
      tenantId: actor.tenantId,
      code: input.code,
      name: input.name,
      entityType: input.entityType,
      description: input.description,
      createdBy: actor.userId,
    });
    const version = await this.repo.createVersion({
      workflowDefinitionId: definition.id,
      versionNumber: 1,
      createdBy: actor.userId,
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "workflow.definition.created",
      entityType: "workflow_definition",
      entityId: definition.id,
      metadata: { code: definition.code, initialVersion: version.versionNumber },
    });
    return { definition, version };
  }

  async listDefinitions(actor: ActorContext): Promise<WorkflowDefinition[]> {
    await this.rbac.requirePermission(actor.userId, "workflow.definition.read");
    return this.repo.listDefinitions(actor.tenantId);
  }

  async createVersion(actor: ActorContext, definitionCode: string) {
    await this.rbac.requirePermission(actor.userId, "workflow.definition.manage");
    const definition = await this.getDefinitionOrThrow(actor.tenantId, definitionCode);
    const nextVersionNumber = await this.repo.getNextVersionNumber(definition.id);
    const version = await this.repo.createVersion({
      workflowDefinitionId: definition.id,
      versionNumber: nextVersionNumber,
      createdBy: actor.userId,
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "workflow.version.created",
      entityType: "workflow_version",
      entityId: version.id,
      metadata: { definitionCode, versionNumber: version.versionNumber },
    });
    return version;
  }

  async listVersions(actor: ActorContext, definitionCode: string): Promise<WorkflowVersion[]> {
    await this.rbac.requirePermission(actor.userId, "workflow.definition.read");
    const definition = await this.getDefinitionOrThrow(actor.tenantId, definitionCode);
    return this.repo.listVersions(definition.id);
  }

  async addStep(
    actor: ActorContext,
    definitionCode: string,
    versionNumber: number,
    input: {
      code: string;
      name: string;
      stepType: WorkflowStepType;
      isInitial?: boolean;
      isTerminal?: boolean;
      terminalStatus?: WorkflowTerminalStatus | null;
      slaHours?: number | null;
      sequenceOrder?: number;
    },
  ) {
    await this.rbac.requirePermission(actor.userId, "workflow.definition.manage");
    const version = await this.getEditableVersionOrThrow(actor.tenantId, definitionCode, versionNumber);
    return this.repo.createStep({
      workflowVersionId: version.id,
      code: input.code,
      name: input.name,
      stepType: input.stepType,
      isInitial: input.isInitial ?? false,
      isTerminal: input.isTerminal ?? false,
      terminalStatus: input.terminalStatus ?? null,
      slaHours: input.slaHours ?? null,
      sequenceOrder: input.sequenceOrder ?? 0,
    });
  }

  async addTransition(
    actor: ActorContext,
    definitionCode: string,
    versionNumber: number,
    input: {
      fromStepCode: string;
      toStepCode: string;
      actionCode: string;
      name: string;
      conditionExpression?: ConditionExpression | null;
      sortOrder?: number;
    },
  ) {
    await this.rbac.requirePermission(actor.userId, "workflow.definition.manage");
    const version = await this.getEditableVersionOrThrow(actor.tenantId, definitionCode, versionNumber);
    const fromStep = await this.repo.findStepByCode(version.id, input.fromStepCode);
    const toStep = await this.repo.findStepByCode(version.id, input.toStepCode);
    if (!fromStep) throw new NotFoundError("WorkflowStep", input.fromStepCode);
    if (!toStep) throw new NotFoundError("WorkflowStep", input.toStepCode);
    return this.repo.createTransition({
      workflowVersionId: version.id,
      fromStepId: fromStep.id,
      toStepId: toStep.id,
      actionCode: input.actionCode,
      name: input.name,
      conditionExpression: input.conditionExpression ?? null,
      sortOrder: input.sortOrder ?? 0,
    });
  }

  async addAssignmentRule(
    actor: ActorContext,
    definitionCode: string,
    versionNumber: number,
    input: {
      stepCode: string;
      assignmentType: WorkflowAssignmentType;
      roleCode?: string | null;
      organizationUnitStrategy?: OrganizationUnitStrategy | null;
      specificUserSource?: SpecificUserSource | null;
      fixedUserId?: string | null;
      conditionExpression?: ConditionExpression | null;
      sortOrder?: number;
    },
  ) {
    await this.rbac.requirePermission(actor.userId, "workflow.definition.manage");
    const version = await this.getEditableVersionOrThrow(actor.tenantId, definitionCode, versionNumber);
    const step = await this.repo.findStepByCode(version.id, input.stepCode);
    if (!step) throw new NotFoundError("WorkflowStep", input.stepCode);
    if (input.assignmentType === "role" && !input.roleCode) {
      throw new ValidationError("roleCode is required when assignmentType is 'role'");
    }
    if (input.assignmentType === "specific_user" && !input.specificUserSource) {
      throw new ValidationError("specificUserSource is required when assignmentType is 'specific_user'");
    }
    return this.repo.createAssignmentRule({
      workflowStepId: step.id,
      sortOrder: input.sortOrder ?? 0,
      conditionExpression: input.conditionExpression ?? null,
      assignmentType: input.assignmentType,
      roleCode: input.roleCode ?? null,
      organizationUnitStrategy: input.organizationUnitStrategy ?? null,
      specificUserSource: input.specificUserSource ?? null,
      fixedUserId: input.fixedUserId ?? null,
    });
  }

  async addEscalationRule(
    actor: ActorContext,
    definitionCode: string,
    versionNumber: number,
    input: {
      stepCode: string;
      escalateAfterHours: number;
      escalateToRoleCode: string;
      escalateToOrganizationUnitStrategy?: OrganizationUnitStrategy;
      note?: string | null;
    },
  ) {
    await this.rbac.requirePermission(actor.userId, "workflow.definition.manage");
    const version = await this.getEditableVersionOrThrow(actor.tenantId, definitionCode, versionNumber);
    const step = await this.repo.findStepByCode(version.id, input.stepCode);
    if (!step) throw new NotFoundError("WorkflowStep", input.stepCode);
    return this.repo.createEscalationRule({
      workflowStepId: step.id,
      escalateAfterHours: input.escalateAfterHours,
      escalateToRoleCode: input.escalateToRoleCode,
      escalateToOrganizationUnitStrategy: input.escalateToOrganizationUnitStrategy ?? "tenant",
      note: input.note ?? null,
    });
  }

  async publishVersion(actor: ActorContext, definitionCode: string, versionNumber: number) {
    await this.rbac.requirePermission(actor.userId, "workflow.definition.manage");
    const definition = await this.getDefinitionOrThrow(actor.tenantId, definitionCode);
    const version = await this.repo.findVersion(definition.id, versionNumber);
    if (!version) throw new NotFoundError("WorkflowVersion", String(versionNumber));
    if (version.status !== "draft") {
      throw new ConflictError(`Workflow Version ${versionNumber} is already '${version.status}', not 'draft'`);
    }

    const steps = await this.repo.listSteps(version.id);
    const problems: string[] = [];
    const initialSteps = steps.filter((s) => s.isInitial);
    if (initialSteps.length !== 1) {
      problems.push(`Version must have exactly one initial Step (found ${initialSteps.length})`);
    }
    const terminalSteps = steps.filter((s) => s.isTerminal);
    if (terminalSteps.length === 0) {
      problems.push("Version must have at least one terminal Step");
    }
    for (const step of steps) {
      if (step.isTerminal) continue;
      const transitions = await this.repo.listTransitionsFromStep(step.id);
      if (transitions.length === 0) {
        problems.push(`Step '${step.code}' is non-terminal but has no outgoing Transition`);
      }
      const rules = await this.repo.listAssignmentRules(step.id);
      if (rules.length === 0) {
        problems.push(`Step '${step.code}' is non-terminal but has no Assignment Rule`);
      }
    }
    if (problems.length > 0) {
      throw new ValidationError("Workflow Version failed publish validation", problems);
    }

    const published = await this.repo.publishVersion(version.id);
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "workflow.version.published",
      entityType: "workflow_version",
      entityId: published.id,
      metadata: { definitionCode, versionNumber: published.versionNumber },
    });
    return published;
  }

  // ======================================================================
  // Runtime — generic dummy object, engine proof only
  // ======================================================================

  async createDemoTransaction(actor: ActorContext, title: string) {
    await this.rbac.requirePermission(actor.userId, "workflow.instance.start");
    const tx = await this.repo.createDemoTransaction({
      tenantId: actor.tenantId,
      title,
      createdBy: actor.userId,
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "workflow.demo_transaction.created",
      entityType: "demo_transaction",
      entityId: tx.id,
      metadata: { title },
    });
    return tx;
  }

  async startInstance(
    actor: ActorContext,
    input: { definitionCode: string; entityId: string; contextData?: Record<string, unknown> },
  ) {
    await this.rbac.requirePermission(actor.userId, "workflow.instance.start");
    const definition = await this.getDefinitionOrThrow(actor.tenantId, input.definitionCode);
    const version = await this.repo.findCurrentVersion(definition.id);
    if (!version) {
      throw new ConflictError(
        `Workflow Definition '${input.definitionCode}' has no published (current) Version yet`,
      );
    }
    const initialStep = await this.repo.findInitialStep(version.id);
    if (!initialStep) {
      // Publish validation guarantees this in practice; guarded here too
      // so a data-integrity bug fails loudly instead of silently.
      throw new ConflictError(`Published Version has no initial Step — data integrity issue`);
    }

    const contextData = input.contextData ?? {};
    const instance = await this.repo.createInstance({
      tenantId: actor.tenantId,
      workflowDefinitionId: definition.id,
      workflowVersionId: version.id,
      entityType: definition.entityType,
      entityId: input.entityId,
      currentStepId: initialStep.id,
      contextData,
      startedBy: actor.userId,
    });

    await this.repo.appendHistory({
      workflowInstanceId: instance.id,
      fromStepId: null,
      toStepId: initialStep.id,
      actionCode: "started",
      actorUserId: actor.userId,
      comment: null,
      metadata: { definitionCode: definition.code, versionNumber: version.versionNumber },
    });

    const assignment = await this.createAssignmentForStep(instance, initialStep.id, initialStep.slaHours);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "workflow.instance.started",
      entityType: "workflow_instance",
      entityId: instance.id,
      metadata: { definitionCode: definition.code, versionNumber: version.versionNumber },
    });

    return { instance, assignment };
  }

  async getInstance(actor: ActorContext, id: string) {
    await this.rbac.requirePermission(actor.userId, "workflow.instance.read");
    const instance = await this.getInstanceOrThrow(actor.tenantId, id);
    const assignments = await this.repo.listAssignmentsForInstance(instance.id);
    return { instance, assignments };
  }

  async listInstances(actor: ActorContext): Promise<WorkflowInstance[]> {
    await this.rbac.requirePermission(actor.userId, "workflow.instance.read");
    return this.repo.listInstances(actor.tenantId);
  }

  async getHistory(actor: ActorContext, instanceId: string) {
    await this.rbac.requirePermission(actor.userId, "workflow.instance.read");
    const instance = await this.getInstanceOrThrow(actor.tenantId, instanceId);
    return this.repo.listHistory(instance.id);
  }

  /** "My Tasks": pending Assignments the actor is actually eligible to act
   * on — either they hold the assigned Role within the assigned scope, or
   * the Assignment names them specifically. */
  async listMyAssignments(actor: ActorContext): Promise<WorkflowInstanceAssignment[]> {
    await this.rbac.requirePermission(actor.userId, "workflow.instance.read");
    const pending = await this.repo.listPendingAssignmentsByTenant(actor.tenantId);
    const mine: WorkflowInstanceAssignment[] = [];
    for (const assignment of pending) {
      if (assignment.assignmentType === "specific_user") {
        if (assignment.assignedUserId === actor.userId) mine.push(assignment);
        continue;
      }
      const covers = await this.rbac.hasRoleCoveringScope(
        actor.userId,
        assignment.assignedRoleCode!,
        assignment.assignedOrganizationUnitId,
      );
      if (covers) mine.push(assignment);
    }
    return mine;
  }

  async actOnAssignment(
    actor: ActorContext,
    assignmentId: string,
    actionCode: string,
    comment: string | null,
  ) {
    await this.rbac.requirePermission(actor.userId, "workflow.instance.act");

    const assignment = await this.repo.findAssignmentById(assignmentId);
    if (!assignment) throw new NotFoundError("WorkflowInstanceAssignment", assignmentId);
    if (assignment.status !== "pending") {
      throw new ConflictError(`This Assignment is already '${assignment.status}', not actionable`);
    }

    const instance = await this.getInstanceOrThrow(actor.tenantId, assignment.workflowInstanceId);

    if (assignment.assignmentType === "specific_user") {
      if (assignment.assignedUserId !== actor.userId) {
        throw new ForbiddenError("This task is assigned to a different user");
      }
    } else {
      const covers = await this.rbac.hasRoleCoveringScope(
        actor.userId,
        assignment.assignedRoleCode!,
        assignment.assignedOrganizationUnitId,
      );
      if (!covers) {
        throw new ForbiddenError(
          `You do not hold role '${assignment.assignedRoleCode}' in the scope this task is assigned to`,
        );
      }
    }

    const currentStep = await this.repo.findStepById(assignment.stepId);
    if (!currentStep) throw new NotFoundError("WorkflowStep", assignment.stepId);

    const transitions = await this.repo.listTransitionsFromStep(currentStep.id);
    const candidates = transitions
      .filter((t) => t.actionCode === actionCode)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const chosen = candidates.find((t) => evaluateCondition(t.conditionExpression, instance.contextData));
    if (!chosen) {
      throw new ValidationError(
        `No Transition configured for action '${actionCode}' from step '${currentStep.code}' matching the current context`,
      );
    }

    const decidedStatus = actionCode === "reject" ? "rejected" : actionCode === "return" ? "returned" : "approved";
    await this.repo.updateAssignmentStatus(assignment.id, {
      status: decidedStatus,
      decidedBy: actor.userId,
      decidedAt: new Date(),
      decisionActionCode: actionCode,
      comment,
    });

    const nextStep = await this.repo.findStepById(chosen.toStepId);
    if (!nextStep) throw new NotFoundError("WorkflowStep", chosen.toStepId);

    await this.repo.appendHistory({
      workflowInstanceId: instance.id,
      fromStepId: currentStep.id,
      toStepId: nextStep.id,
      actionCode,
      actorUserId: actor.userId,
      comment,
      metadata: null,
    });
    await this.repo.recordNotificationHook({
      workflowInstanceId: instance.id,
      eventType: decidedStatus,
      payload: { fromStepCode: currentStep.code, toStepCode: nextStep.code, actorUserId: actor.userId, comment },
    });

    await this.repo.updateInstanceCurrentStep(instance.id, nextStep.id);

    let newAssignment: WorkflowInstanceAssignment | null = null;
    if (nextStep.isTerminal) {
      await this.repo.completeInstance(instance.id, nextStep.terminalStatus!);
      await this.repo.appendHistory({
        workflowInstanceId: instance.id,
        fromStepId: currentStep.id,
        toStepId: nextStep.id,
        actionCode: "completed",
        actorUserId: null,
        comment: null,
        metadata: { terminalStatus: nextStep.terminalStatus },
      });
      await this.repo.recordNotificationHook({
        workflowInstanceId: instance.id,
        eventType: "completed",
        payload: { terminalStatus: nextStep.terminalStatus },
      });
    } else {
      newAssignment = await this.createAssignmentForStep(instance, nextStep.id, nextStep.slaHours);
    }

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "workflow.instance.acted",
      entityType: "workflow_instance",
      entityId: instance.id,
      metadata: { actionCode, fromStep: currentStep.code, toStep: nextStep.code },
    });

    return {
      instance: (await this.repo.findInstanceById(instance.id))!,
      decidedAssignmentId: assignment.id,
      newAssignment,
    };
  }

  /**
   * Escalation sweep — explicit, RBAC-gated operation that reassigns
   * every overdue pending Assignment per its Step's Escalation Rule (if
   * one is configured; Steps without one are left overdue on purpose,
   * since Escalation is opt-in per Step). No automatic scheduler invokes
   * this in Phase 0 — see the migration file header and
   * docs/decision-log.md for why that's an accepted, documented gap
   * rather than a silent omission.
   */
  async escalateOverdueAssignments(actor: ActorContext) {
    await this.rbac.requirePermission(actor.userId, "workflow.instance.manage");
    const overdue = await this.repo.listOverdueAssignments(actor.tenantId);
    const escalated: WorkflowInstanceAssignment[] = [];

    for (const assignment of overdue) {
      const rule = await this.repo.findEscalationRule(assignment.stepId);
      if (!rule) continue;

      const step = await this.repo.findStepById(assignment.stepId);
      const instance = await this.repo.findInstanceById(assignment.workflowInstanceId);
      if (!step || !instance) continue;

      await this.repo.updateAssignmentStatus(assignment.id, {
        status: "escalated",
        decidedBy: null,
        decidedAt: new Date(),
        decisionActionCode: "escalated",
        comment: `Escalated automatically: SLA of ${step.slaHours ?? "?"}h exceeded`,
      });

      const organizationUnitId =
        rule.escalateToOrganizationUnitStrategy === "submitter_unit"
          ? ((instance.contextData as Record<string, unknown>).organizationUnitId as string | undefined) ??
            null
          : null;
      const dueAt = step.slaHours != null ? new Date(Date.now() + step.slaHours * 3600 * 1000) : null;

      const newAssignment = await this.repo.createAssignment({
        workflowInstanceId: instance.id,
        stepId: step.id,
        assignmentType: "role",
        assignedRoleCode: rule.escalateToRoleCode,
        assignedOrganizationUnitId: organizationUnitId,
        assignedUserId: null,
        dueAt,
      });

      await this.repo.appendHistory({
        workflowInstanceId: instance.id,
        fromStepId: step.id,
        toStepId: step.id,
        actionCode: "escalated",
        actorUserId: null,
        comment: `Escalated to role '${rule.escalateToRoleCode}' after ${rule.escalateAfterHours}h SLA`,
        metadata: { originalAssignmentId: assignment.id, newAssignmentId: newAssignment.id },
      });
      await this.repo.recordNotificationHook({
        workflowInstanceId: instance.id,
        eventType: "escalated",
        payload: {
          stepCode: step.code,
          escalateToRoleCode: rule.escalateToRoleCode,
          newAssignmentId: newAssignment.id,
        },
      });
      await this.audit.record({
        tenantId: actor.tenantId,
        actorUserId: null,
        action: "workflow.instance.escalated",
        entityType: "workflow_instance",
        entityId: instance.id,
        metadata: { stepCode: step.code, escalateToRoleCode: rule.escalateToRoleCode },
      });

      escalated.push(newAssignment);
    }

    return escalated;
  }

  // ======================================================================
  // Internals
  // ======================================================================

  private async getDefinitionOrThrow(tenantId: string, code: string): Promise<WorkflowDefinition> {
    const definition = await this.repo.findDefinitionByCode(tenantId, code);
    if (!definition) throw new NotFoundError("WorkflowDefinition", code);
    return definition;
  }

  private async getEditableVersionOrThrow(
    tenantId: string,
    definitionCode: string,
    versionNumber: number,
  ): Promise<WorkflowVersion> {
    const definition = await this.getDefinitionOrThrow(tenantId, definitionCode);
    const version = await this.repo.findVersion(definition.id, versionNumber);
    if (!version) throw new NotFoundError("WorkflowVersion", String(versionNumber));
    if (version.status !== "draft") {
      throw new ConflictError(
        `Workflow Version ${versionNumber} is '${version.status}' — only a 'draft' Version can be edited`,
      );
    }
    return version;
  }

  private async getInstanceOrThrow(tenantId: string, id: string): Promise<WorkflowInstance> {
    const instance = await this.repo.findInstanceById(id);
    if (!instance || instance.tenantId !== tenantId) {
      throw new NotFoundError("WorkflowInstance", id);
    }
    return instance;
  }

  /** Resolves the Assignment Rule that matches (first Condition match
   * wins, per doc 04's "Dynamic Routing"), creates the resulting
   * Assignment + due date (SLA-ready hook), and fires the
   * Notification-ready hook. */
  private async createAssignmentForStep(
    instance: WorkflowInstance,
    stepId: string,
    slaHours: number | null,
  ): Promise<WorkflowInstanceAssignment> {
    const rules = await this.repo.listAssignmentRules(stepId);
    const matched = rules
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .find((rule) => evaluateCondition(rule.conditionExpression, instance.contextData));
    if (!matched) {
      throw new ConflictError(`No matching Assignment Rule for the current context at this Step`);
    }

    let assignedRoleCode: string | null = null;
    let assignedOrganizationUnitId: string | null = null;
    let assignedUserId: string | null = null;

    if (matched.assignmentType === "role") {
      assignedRoleCode = matched.roleCode;
      assignedOrganizationUnitId =
        matched.organizationUnitStrategy === "submitter_unit"
          ? ((instance.contextData as Record<string, unknown>).organizationUnitId as string | undefined) ??
            null
          : null;
    } else {
      assignedUserId =
        matched.specificUserSource === "submitter" ? instance.startedBy : matched.fixedUserId;
    }

    const dueAt = slaHours != null ? new Date(Date.now() + slaHours * 3600 * 1000) : null;

    const assignment = await this.repo.createAssignment({
      workflowInstanceId: instance.id,
      stepId,
      assignmentType: matched.assignmentType,
      assignedRoleCode,
      assignedOrganizationUnitId,
      assignedUserId,
      dueAt,
    });

    await this.repo.recordNotificationHook({
      workflowInstanceId: instance.id,
      eventType: "assigned",
      payload: {
        assignmentId: assignment.id,
        assignmentType: matched.assignmentType,
        roleCode: assignedRoleCode,
        organizationUnitId: assignedOrganizationUnitId,
        userId: assignedUserId,
        dueAt,
      },
    });

    return assignment;
  }
}
