import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../../../domain/shared-kernel/errors.js";
import type { AuditService } from "../../../../application/audit/audit.service.js";
import type { RbacService } from "../../../../application/rbac/rbac.service.js";
import type { EventBus } from "../../../../application/event/event-bus.js";
import type { ConfigurationService } from "../../../../application/configuration/configuration.service.js";
import type { ServiceOperationsService } from "../../core/application/service-operations.service.js";
import type {
  OptimizationAssignmentProposal,
  OptimizationParameters,
  OptimizationRun,
  ServiceOperationsAdvancedRepository,
  ServicePackActivation,
  ServicePackCode,
  ServicePackPreset,
} from "../domain/service-operations-advanced.entity.js";
import { SERVICE_PACK_CODES } from "../domain/service-operations-advanced.entity.js";

/** Configuration numbering code for optimization runs. */
export const OPTIMIZATION_RUN_NUMBERING_CODE = "service_optimization_run";

/**
 * Vertical Service Pack presets (PACK-001…004).
 *
 * Each preset configures standard service definitions and structured
 * checklists in generic Service Operations Core. No industry-specific
 * database tables are created.
 */
export const SERVICE_PACK_PRESETS: Record<ServicePackCode, ServicePackPreset> = {
  catering: {
    packCode: "catering",
    name: "Catering Service Pack (PACK-001)",
    description: "Packaged catering operations with meal preparation, food safety, and banquet checklists",
    serviceDefinitions: [
      {
        code: "catering_meal_service",
        name: "Meal Preparation & Service",
        description: "Routine meal preparation, temperature logging, and food hygiene distribution",
        category: "catering",
        checklistItems: [
          { code: "temp_check", label: "Food temperature check (<5°C cold / >60°C hot)", isRequired: true, sortOrder: 10 },
          { code: "hygiene_inspect", label: "Kitchen prep area & utensils hygiene inspection", isRequired: true, sortOrder: 20 },
          { code: "sample_retention", label: "Daily food sample retained in freezer (72 hours)", isRequired: true, sortOrder: 30 },
          { code: "waste_disposal", label: "Organic & general kitchen waste segregated and disposed", isRequired: false, sortOrder: 40 },
        ],
      },
      {
        code: "catering_event_banquet",
        name: "Banquet & Event Catering",
        description: "Special event and executive banquet food service delivery",
        category: "catering",
        checklistItems: [
          { code: "table_setup", label: "Dining layout, buffet warmers, and cutlery verified", isRequired: true, sortOrder: 10 },
          { code: "allergen_tagging", label: "Menu allergen advisory labeling verified on display", isRequired: true, sortOrder: 20 },
          { code: "headcount_confirm", label: "Actual meal headcount confirmed against service voucher", isRequired: true, sortOrder: 30 },
        ],
      },
    ],
  },
  housekeeping: {
    packCode: "housekeeping",
    name: "Housekeeping Service Pack (PACK-002)",
    description: "Packaged housekeeping operations with room turnover and public area sanitization",
    serviceDefinitions: [
      {
        code: "housekeeping_room_cleaning",
        name: "Room Turnover & Cleaning",
        description: "Guest room and accommodation daily turnover and sanitization",
        category: "housekeeping",
        checklistItems: [
          { code: "linen_change", label: "Bedsheets and pillowcases replaced with fresh linen", isRequired: true, sortOrder: 10 },
          { code: "bathroom_sanitize", label: "Bathroom, toilet, and shower deep cleaned and sanitized", isRequired: true, sortOrder: 20 },
          { code: "amenity_replenish", label: "Toiletries, water, and room consumables replenished", isRequired: true, sortOrder: 30 },
          { code: "floor_mop", label: "Floor vacuumed and mopped with disinfectant", isRequired: true, sortOrder: 40 },
        ],
      },
      {
        code: "housekeeping_public_area",
        name: "Public Area Deep Sanitization",
        description: "Lobby, corridors, and communal facility routine sanitization",
        category: "housekeeping",
        checklistItems: [
          { code: "touchpoint_disinfect", label: "Door handles, railings, and lift buttons disinfected", isRequired: true, sortOrder: 10 },
          { code: "trash_clear", label: "Public waste bins emptied, sanitized, and relined", isRequired: true, sortOrder: 20 },
        ],
      },
    ],
  },
  camp: {
    packCode: "camp",
    name: "Camp Services Pack (PACK-003)",
    description: "Packaged camp management with accommodation check-in/out and utility inspections",
    serviceDefinitions: [
      {
        code: "camp_occupancy_turnover",
        name: "Camp Room Check-in / Checkout",
        description: "Worker camp room assignment, key handover, and inventory inspection",
        category: "camp",
        checklistItems: [
          { code: "key_card_issuance", label: "Room access card/key verified and issued", isRequired: true, sortOrder: 10 },
          { code: "inventory_audit", label: "Room furniture, mattress, and locker inventory audited", isRequired: true, sortOrder: 20 },
          { code: "hvac_functional", label: "Air conditioning and electrical points function tested", isRequired: true, sortOrder: 30 },
        ],
      },
      {
        code: "camp_water_wastewater",
        name: "Camp Potable Water & Waste Inspection",
        description: "Daily inspection of potable water treatment and wastewater handling",
        category: "camp",
        checklistItems: [
          { code: "chlorine_test", label: "Free residual chlorine level tested (0.2 - 0.5 ppm)", isRequired: true, sortOrder: 10 },
          { code: "tank_level_check", label: "Potable water storage reservoir level recorded", isRequired: true, sortOrder: 20 },
        ],
      },
    ],
  },
  facility: {
    packCode: "facility",
    name: "Facility Services Pack (PACK-004)",
    description: "Packaged facility management with building, lighting, and HVAC inspections",
    serviceDefinitions: [
      {
        code: "facility_routine_inspection",
        name: "Building Routine Inspection",
        description: "General facility inspection covering lighting, safety, and plumbing",
        category: "facility",
        checklistItems: [
          { code: "lighting_check", label: "Emergency exits and general lighting functional", isRequired: true, sortOrder: 10 },
          { code: "fire_extinguisher", label: "Fire extinguishers inspected (pressure gauge & tag valid)", isRequired: true, sortOrder: 20 },
          { code: "plumbing_leak_check", label: "Plumbing lines and washrooms checked for leaks", isRequired: true, sortOrder: 30 },
        ],
      },
      {
        code: "facility_hvac_filter",
        name: "HVAC Filter & Air Handling Check",
        description: "Periodic inspection and filter maintenance of air handling units",
        category: "facility",
        checklistItems: [
          { code: "filter_clean", label: "Primary and secondary air filters cleaned or replaced", isRequired: true, sortOrder: 10 },
          { code: "belt_tension", label: "Fan belt tension and motor vibration inspected", isRequired: true, sortOrder: 20 },
        ],
      },
    ],
  },
};

export interface ServicePackView {
  packCode: ServicePackCode;
  name: string;
  description: string;
  isActive: boolean;
  activatedAt: Date | null;
  activatedBy: string | null;
  presetServiceCount: number;
}

export interface GenerateOptimizationRunInput {
  targetDate: string; // YYYY-MM-DD
  organizationUnitId?: string | null;
  parameters?: OptimizationParameters;
}

export class ServiceOperationsAdvancedService {
  constructor(
    private readonly repo: ServiceOperationsAdvancedRepository,
    private readonly serviceOperations: ServiceOperationsService,
    private readonly configuration: ConfigurationService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly eventBus: EventBus,
  ) {}

  // =========================================================================
  // Vertical Service Packs (PACK-001…004)
  // =========================================================================

  async listPacks(actor: ActorContext): Promise<ServicePackView[]> {
    await this.rbac.requirePermission(actor, "service_operations.pack.manage");
    const activations = await this.repo.listPackActivations(actor.tenantId);
    const activationByCode = new Map<ServicePackCode, ServicePackActivation>(
      activations.map((a) => [a.packCode, a]),
    );

    return SERVICE_PACK_CODES.map((code) => {
      const preset = SERVICE_PACK_PRESETS[code];
      const activation = activationByCode.get(code);
      return {
        packCode: code,
        name: preset.name,
        description: preset.description,
        isActive: activation?.isActive ?? false,
        activatedAt: activation?.activatedAt ?? null,
        activatedBy: activation?.activatedBy ?? null,
        presetServiceCount: preset.serviceDefinitions.length,
      };
    });
  }

  async getPack(actor: ActorContext, packCode: string): Promise<ServicePackView & { preset: ServicePackPreset }> {
    await this.rbac.requirePermission(actor, "service_operations.pack.manage");
    const code = this.parsePackCode(packCode);
    const preset = SERVICE_PACK_PRESETS[code];
    const activation = await this.repo.getPackActivation(actor.tenantId, code);

    return {
      packCode: code,
      name: preset.name,
      description: preset.description,
      isActive: activation?.isActive ?? false,
      activatedAt: activation?.activatedAt ?? null,
      activatedBy: activation?.activatedBy ?? null,
      presetServiceCount: preset.serviceDefinitions.length,
      preset,
    };
  }

  async activatePack(
    actor: ActorContext,
    packCode: string,
    options: { seedPresets?: boolean } = {},
  ): Promise<ServicePackActivation> {
    await this.rbac.requirePermission(actor, "service_operations.pack.manage");
    const code = this.parsePackCode(packCode);
    const preset = SERVICE_PACK_PRESETS[code];

    const activation = await this.repo.upsertPackActivation(
      actor.tenantId,
      code,
      true,
      actor.userId,
    );

    // If requested (default true), provision the pack's standard service
    // definitions and checklists into generic Service Operations Core.
    if (options.seedPresets !== false) {
      await this.seedPackPresets(actor, preset);
    }

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "service_operations.pack.activated",
      entityType: "service_pack_activation",
      entityId: activation.id,
      metadata: { packCode: code, name: preset.name },
    });

    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: "service_operations.pack.activated",
      entityType: "service_pack_activation",
      entityId: activation.id,
      payload: { packCode: code, name: preset.name },
      createdBy: actor.userId,
    });

    return activation;
  }

  async deactivatePack(actor: ActorContext, packCode: string): Promise<ServicePackActivation> {
    await this.rbac.requirePermission(actor, "service_operations.pack.manage");
    const code = this.parsePackCode(packCode);
    const preset = SERVICE_PACK_PRESETS[code];

    const activation = await this.repo.upsertPackActivation(
      actor.tenantId,
      code,
      false,
      actor.userId,
    );

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "service_operations.pack.deactivated",
      entityType: "service_pack_activation",
      entityId: activation.id,
      metadata: { packCode: code, name: preset.name },
    });

    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: "service_operations.pack.deactivated",
      entityType: "service_pack_activation",
      entityId: activation.id,
      payload: { packCode: code, name: preset.name },
      createdBy: actor.userId,
    });

    return activation;
  }

  // =========================================================================
  // Route, Roster, Capacity & Workload Optimization (SO-ADV-002…005)
  // =========================================================================

  async generateOptimizationRun(
    actor: ActorContext,
    input: GenerateOptimizationRunInput,
  ): Promise<OptimizationRun> {
    await this.rbac.requirePermission(actor, "service_operations.optimization.read");
    const targetDate = this.validateTargetDate(input.targetDate);

    if (input.organizationUnitId) {
      await this.rbac.requireOrganizationUnitScopeForActor(actor, input.organizationUnitId);
    }

    const [workers, workOrders] = await Promise.all([
      this.repo.listEligibleWorkers(actor.tenantId, input.organizationUnitId),
      this.repo.listUnassignedWorkOrders(actor.tenantId, targetDate, input.organizationUnitId),
    ]);

    if (workers.length === 0) {
      throw new ValidationError("No eligible active field workers available for optimization");
    }

    const proposals = this.computeOptimizationProposals(workOrders, workers, input.parameters ?? {});

    const { number: runNumber } = await this.configuration.generateNumberForTenant(
      actor.tenantId,
      OPTIMIZATION_RUN_NUMBERING_CODE,
      actor.userId,
    );

    const run = await this.repo.createOptimizationRun({
      tenantId: actor.tenantId,
      runNumber,
      targetDate,
      organizationUnitId: input.organizationUnitId ?? null,
      parameters: input.parameters ?? {},
      proposals,
      createdBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "service_operations.optimization.generated",
      entityType: "service_optimization_run",
      entityId: run.id,
      metadata: {
        runNumber: run.runNumber,
        targetDate,
        workOrdersEvaluated: workOrders.length,
        proposalsCount: proposals.length,
        workersConsidered: workers.length,
      },
    });

    return run;
  }

  async listOptimizationRuns(actor: ActorContext, limit?: number): Promise<OptimizationRun[]> {
    await this.rbac.requirePermission(actor, "service_operations.optimization.read");
    return this.repo.listOptimizationRuns(actor.tenantId, limit);
  }

  async getOptimizationRun(actor: ActorContext, id: string): Promise<OptimizationRun> {
    await this.rbac.requirePermission(actor, "service_operations.optimization.read");
    const run = await this.repo.findOptimizationRunById(actor.tenantId, id);
    if (!run) throw new NotFoundError("OptimizationRun", id);
    return run;
  }

  /**
   * Human-confirmed optimization apply (SO-ADV-002…005).
   *
   * Every proposed assignment is executed with idempotent update guards.
   * Work orders that were assigned concurrently in the meantime are safely
   * skipped without failing the entire batch.
   */
  async applyOptimizationRun(
    actor: ActorContext,
    id: string,
  ): Promise<{ run: OptimizationRun; appliedCount: number; skippedCount: number }> {
    await this.rbac.requirePermission(actor, "service_operations.optimization.apply");
    const run = await this.repo.findOptimizationRunById(actor.tenantId, id);
    if (!run) throw new NotFoundError("OptimizationRun", id);
    if (run.status !== "proposed") {
      throw new ConflictError(`Optimization run is '${run.status}' and cannot be applied`);
    }

    // Claim the proposal and apply every guarded work-order assignment in one
    // database transaction. A crash cannot leave the run marked applied with a
    // partially executed assignment batch, and concurrent callers lose before
    // any side effects.
    const applied = await this.repo.applyOptimizationRunAssignments(actor.tenantId, run.id, actor.userId);
    if (!applied) {
      const current = await this.repo.findOptimizationRunById(actor.tenantId, run.id);
      throw new ConflictError(
        `Optimization run is '${current?.status ?? "unavailable"}' and cannot be applied`,
      );
    }

    const appliedRun = applied.run;
    const assignedIds = new Set(applied.assignedWorkOrderIds);
    const appliedCount = assignedIds.size;
    const skippedCount = appliedRun.proposals.length - appliedCount;

    for (const proposal of appliedRun.proposals) {
      if (!assignedIds.has(proposal.workOrderId)) continue;
      await this.audit.record({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "work_order.assigned",
        entityType: "work_order",
        entityId: proposal.workOrderId,
        metadata: {
          workOrderNumber: proposal.workOrderNumber,
          assigneeUserId: proposal.recommendedUserId,
          sourceOptimizationRunId: appliedRun.id,
        },
      });
      await this.eventBus.publish({
        tenantId: actor.tenantId,
        eventType: "work_order.assigned",
        entityType: "work_order",
        entityId: proposal.workOrderId,
        payload: {
          workOrderNumber: proposal.workOrderNumber,
          targetUserId: proposal.recommendedUserId,
          assignedByUserId: actor.userId,
        },
        createdBy: actor.userId,
      });
    }

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "service_operations.optimization.applied",
      entityType: "service_optimization_run",
      entityId: appliedRun.id,
      metadata: { runNumber: appliedRun.runNumber, appliedCount, skippedCount },
    });

    return { run: appliedRun, appliedCount, skippedCount };
  }

  async dismissOptimizationRun(actor: ActorContext, id: string): Promise<OptimizationRun> {
    await this.rbac.requirePermission(actor, "service_operations.optimization.apply");
    const run = await this.repo.findOptimizationRunById(actor.tenantId, id);
    if (!run) throw new NotFoundError("OptimizationRun", id);
    if (run.status !== "proposed") {
      throw new ConflictError(`Optimization run is '${run.status}' and cannot be dismissed`);
    }

    const dismissed = await this.repo.markOptimizationRunDismissed(actor.tenantId, run.id);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "service_operations.optimization.dismissed",
      entityType: "service_optimization_run",
      entityId: run.id,
      metadata: { runNumber: run.runNumber },
    });

    return dismissed!;
  }

  // =========================================================================
  // Internals & Deterministic Heuristics
  // =========================================================================

  private computeOptimizationProposals(
    workOrders: import("../domain/service-operations-advanced.entity.js").CandidateWorkOrder[],
    workers: import("../domain/service-operations-advanced.entity.js").CandidateWorker[],
    parameters: OptimizationParameters,
  ): OptimizationAssignmentProposal[] {
    if (workOrders.length === 0 || workers.length === 0) return [];

    const priorityWeight: Record<string, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
    };

    // Sort work orders: high priority first, then earliest due date/planned start
    const sortedOrders = [...workOrders].sort((a, b) => {
      const pA = priorityWeight[a.priority ?? "medium"] ?? 2;
      const pB = priorityWeight[b.priority ?? "medium"] ?? 2;
      if (pA !== pB) return pB - pA;
      const tA = a.dueAt?.getTime() ?? a.plannedStartAt?.getTime() ?? 0;
      const tB = b.dueAt?.getTime() ?? b.plannedStartAt?.getTime() ?? 0;
      return tA - tB;
    });

    // Track simulated workload per worker
    const workerLoad = new Map<string, { worker: import("../domain/service-operations-advanced.entity.js").CandidateWorker; assignedCount: number; assignedMinutes: number }>();
    for (const w of workers) {
      workerLoad.set(w.userId, {
        worker: w,
        assignedCount: w.currentActiveWorkOrdersCount,
        assignedMinutes: w.currentActiveWorkOrdersCount * 60,
      });
    }

    const proposals: OptimizationAssignmentProposal[] = [];
    const maxOrdersPerWorker = parameters.maxWorkOrdersPerWorker ?? 8;
    const defaultMinutesPerOrder = 60;

    for (const order of sortedOrders) {
      // Find candidate worker with lowest total load who hasn't exceeded the max threshold
      let bestCandidate: { worker: import("../domain/service-operations-advanced.entity.js").CandidateWorker; assignedCount: number; assignedMinutes: number } | null = null;
      let minLoad = Infinity;

      for (const item of workerLoad.values()) {
        if (item.assignedCount >= maxOrdersPerWorker) continue;
        if (item.assignedCount < minLoad) {
          minLoad = item.assignedCount;
          bestCandidate = item;
        }
      }

      // Fallback to least loaded worker overall if all reached the max threshold
      if (!bestCandidate) {
        let absoluteMin = Infinity;
        for (const item of workerLoad.values()) {
          if (item.assignedCount < absoluteMin) {
            absoluteMin = item.assignedCount;
            bestCandidate = item;
          }
        }
      }

      if (!bestCandidate) continue;

      const rationale = `Recommended ${bestCandidate.worker.fullName} based on capacity leveling (current load: ${bestCandidate.assignedCount} active orders, least loaded eligible worker in unit).`;

      proposals.push({
        workOrderId: order.id,
        workOrderNumber: order.workOrderNumber,
        title: order.title,
        priority: order.priority,
        customerId: order.customerId,
        siteId: order.siteId,
        organizationUnitId: bestCandidate.worker.organizationUnitId,
        recommendedUserId: bestCandidate.worker.userId,
        recommendedUserName: bestCandidate.worker.fullName,
        estimatedMinutes: defaultMinutesPerOrder,
        rationale,
      });

      bestCandidate.assignedCount += 1;
      bestCandidate.assignedMinutes += defaultMinutesPerOrder;
    }

    return proposals;
  }

  private async seedPackPresets(actor: ActorContext, preset: ServicePackPreset): Promise<void> {
    for (const def of preset.serviceDefinitions) {
      try {
        await this.serviceOperations.createServiceDefinition(actor, {
          code: def.code,
          name: def.name,
          description: def.description,
          category: def.category,
        });

        for (const item of def.checklistItems) {
          try {
            await this.serviceOperations.addChecklistTemplateItem(actor, def.code, {
              code: item.code,
              label: item.label,
              isRequired: item.isRequired,
              sortOrder: item.sortOrder,
            });
          } catch {
            // Item might already exist — idempotent
          }
        }
      } catch (err) {
        if (err instanceof ConflictError) {
          // Definition already exists — ensure checklist items exist
          for (const item of def.checklistItems) {
            try {
              await this.serviceOperations.addChecklistTemplateItem(actor, def.code, {
                code: item.code,
                label: item.label,
                isRequired: item.isRequired,
                sortOrder: item.sortOrder,
              });
            } catch {
              // Item might already exist — idempotent
            }
          }
        } else {
          throw err;
        }
      }
    }
  }

  private parsePackCode(code: string): ServicePackCode {
    if (!SERVICE_PACK_CODES.includes(code as ServicePackCode)) {
      throw new ValidationError(`Invalid pack code '${code}'. Valid codes: ${SERVICE_PACK_CODES.join(", ")}`);
    }
    return code as ServicePackCode;
  }

  private validateTargetDate(dateStr: string): string {
    const trimmed = (dateStr ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      throw new ValidationError(`Invalid targetDate '${dateStr}'. Expected format YYYY-MM-DD.`);
    }
    const d = new Date(`${trimmed}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) {
      throw new ValidationError(`targetDate '${dateStr}' is not a valid calendar date.`);
    }
    return trimmed;
  }
}
