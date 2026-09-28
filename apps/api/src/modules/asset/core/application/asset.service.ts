import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../../domain/shared-kernel/errors.js";
import type { AuditService } from "../../../../application/audit/audit.service.js";
import type { RbacService } from "../../../../application/rbac/rbac.service.js";
import type { EventBus } from "../../../../application/event/event-bus.js";
import type { ConfigurationService } from "../../../../application/configuration/configuration.service.js";
import type { WorkflowService } from "../../../../application/workflow/workflow.service.js";
import type {
  Asset,
  AssetListFilter,
  AssetMovement,
  AssetPlacementChange,
  AssetRepository,
  AssetStatus,
  CustodianReference,
} from "../domain/asset.entity.js";
import { ASSET_STATUSES, isTerminalAssetStatus } from "../domain/asset.entity.js";

/** Tenant Configuration codes this module expects. */
export const ASSET_NUMBERING_CODE = "asset";
export const ASSET_MOVEMENT_WORKFLOW_DEFINITION_CODE = "asset_movement_approval";

/** Workflow action code → domain event name. The Step graph itself is Tenant
 * Configuration; this only names the events the chosen action codes publish. */
const ACTION_EVENT_MAP: Record<string, string> = {
  submit: "asset.movement.submitted",
  approve: "asset.movement.approved",
  reject: "asset.movement.rejected",
  cancel: "asset.movement.cancelled",
};

export interface AssetMovementView {
  movement: AssetMovement;
  status: { stepCode: string | null; stepName: string | null; instanceStatus: string } | null;
  availableActions: { actionCode: string; name: string; toStepCode: string }[];
}

export interface AssetDetailView {
  asset: Asset;
  custodian: CustodianReference | null;
  movements: AssetMovement[];
  /** Present only while a movement is waiting on the configured approval
   * lifecycle — null when the tenant requires no approval. */
  pendingMovement: AssetMovementView | null;
}

/**
 * Asset Core (Phase 5, AST-CORE-001…010).
 *
 * Answers: what asset exists, what is its identity/tag, where is it, who is
 * responsible for it, what is its status, and how did it move.
 *
 * Architectural constraints honoured here:
 * - **Register, not CMMS.** No preventive/corrective maintenance, work
 *   orders, meters, downtime, reliability metrics, or condition monitoring.
 * - **Register, not ledger of value.** No depreciation, book value,
 *   capitalisation, or disposal gain/loss — that is Finance Advanced.
 * - **Placement changes only through the ledger.** `updateAsset` touches
 *   descriptive fields; location, custodian and status move exclusively
 *   through a movement, so history can never be bypassed.
 * - **Workflow owns approval** (AST-CORE-007) and only when the client
 *   configured it. There is no second lifecycle engine and no status column
 *   on the movement.
 * - **No module-to-module coupling.** Custodian is an employee *id* resolved
 *   through this module's own repository port; nothing from Workforce,
 *   Supply Chain, or Service Operations is imported.
 */
export class AssetService {
  constructor(
    private readonly repo: AssetRepository,
    private readonly workflow: WorkflowService,
    private readonly configuration: ConfigurationService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly eventBus: EventBus,
  ) {}

  // ===================================================================
  // Asset master — AST-CORE-001…005
  // ===================================================================

  async createAsset(
    actor: ActorContext,
    input: {
      name: string;
      assetTag?: string | null;
      description?: string | null;
      category?: string | null;
      status?: string;
      organizationUnitId?: string | null;
      custodianEmployeeId?: string | null;
      projectId?: string | null;
      siteId?: string | null;
      locationDetail?: string | null;
      acquisitionReference?: string | null;
      acquiredAt?: string | null;
    },
  ): Promise<AssetDetailView> {
    await this.rbac.requirePermission(actor, "asset.manage");

    const assetTag = this.normaliseTag(input.assetTag);
    if (assetTag && (await this.repo.findAssetByTag(actor.tenantId, assetTag))) {
      throw new ConflictError("Asset tag already exists: " + assetTag);
    }

    const status = this.parseStatus(input.status ?? "in_use");
    const organizationUnitId = await this.resolveOrganizationUnit(actor, input.organizationUnitId ?? null);
    const projectId = await this.resolveProject(actor, input.projectId ?? null);
    const siteId = await this.resolveSite(actor, input.siteId ?? null);
    const custodianEmployeeId = await this.resolveCustodian(actor, input.custodianEmployeeId ?? null);

    const { number } = await this.configuration.generateNumberForTenant(
      actor.tenantId,
      ASSET_NUMBERING_CODE,
      actor.userId,
    );

    const asset = await this.repo.createAsset({
      tenantId: actor.tenantId,
      assetNumber: number,
      assetTag,
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? null,
      status,
      organizationUnitId,
      custodianEmployeeId,
      projectId,
      siteId,
      locationDetail: input.locationDetail ?? null,
      acquisitionReference: input.acquisitionReference ?? null,
      acquiredAt: this.parseDate(input.acquiredAt, "acquiredAt"),
      createdBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "asset.created",
      entityType: "asset",
      entityId: asset.id,
      metadata: { assetNumber: asset.assetNumber, assetTag, category: asset.category, organizationUnitId },
    });
    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: "asset.created",
      entityType: "asset",
      entityId: asset.id,
      payload: { assetNumber: asset.assetNumber, name: asset.name },
      createdBy: actor.userId,
    });

    return this.getAsset(actor, asset.id);
  }

  async listAssets(
    actor: ActorContext,
    filter: {
      search?: string;
      category?: string;
      status?: string;
      organizationUnitId?: string;
      siteId?: string;
      custodianEmployeeId?: string;
      includeTerminal?: boolean;
    } = {},
  ): Promise<{ assets: Asset[]; custodians: CustodianReference[] }> {
    await this.rbac.requirePermission(actor, "asset.read");
    const repoFilter: AssetListFilter = {
      search: filter.search,
      category: filter.category,
      status: filter.status ? this.parseStatus(filter.status) : undefined,
      organizationUnitId: filter.organizationUnitId,
      siteId: filter.siteId,
      custodianEmployeeId: filter.custodianEmployeeId,
      includeTerminal: filter.includeTerminal,
    };
    const assets = await this.filterByOrganizationScope(actor, await this.repo.listAssets(actor.tenantId, repoFilter));
    // One batched lookup rather than one query per row.
    const custodianIds = [...new Set(assets.map((a) => a.custodianEmployeeId).filter((id): id is string => !!id))];
    const custodians = await this.repo.listCustodianReferences(actor.tenantId, custodianIds);
    return { assets, custodians };
  }

  async getAsset(actor: ActorContext, id: string): Promise<AssetDetailView> {
    await this.rbac.requirePermission(actor, "asset.read");
    const asset = await this.getAuthorizedAsset(actor, id);
    const [custodian, movements, pending] = await Promise.all([
      asset.custodianEmployeeId
        ? this.repo.findCustodianReference(actor.tenantId, asset.custodianEmployeeId)
        : Promise.resolve(null),
      this.repo.listMovements(asset.id),
      this.repo.findPendingMovementForAsset(asset.id),
    ]);

    let pendingMovement: AssetMovementView | null = null;
    if (pending) {
      const view = await this.describeMovement(actor, pending);
      // A rejected or cancelled request is history, not something waiting.
      if (view.status && view.status.instanceStatus === "in_progress") pendingMovement = view;
    }
    return { asset, custodian, movements, pendingMovement };
  }

  /**
   * Descriptive fields only. Location, custodian and status are deliberately
   * NOT editable here — changing them silently would destroy history
   * (AST-CORE-006).
   */
  async updateAsset(
    actor: ActorContext,
    id: string,
    input: {
      assetTag?: string | null;
      name?: string;
      description?: string | null;
      category?: string | null;
      acquisitionReference?: string | null;
      acquiredAt?: string | null;
    },
  ): Promise<AssetDetailView> {
    await this.rbac.requirePermission(actor, "asset.manage");
    const asset = await this.getAuthorizedAsset(actor, id);

    if (input.assetTag !== undefined) {
      const tag = this.normaliseTag(input.assetTag);
      if (tag) {
        const clash = await this.repo.findAssetByTag(actor.tenantId, tag);
        if (clash && clash.id !== asset.id) throw new ConflictError("Asset tag already exists: " + tag);
      }
      input = { ...input, assetTag: tag };
    }
    if (input.acquiredAt !== undefined) {
      input = { ...input, acquiredAt: this.parseDate(input.acquiredAt, "acquiredAt") };
    }

    await this.repo.updateAsset(asset.id, input, actor.userId);
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "asset.updated",
      entityType: "asset",
      entityId: asset.id,
      metadata: { assetNumber: asset.assetNumber, fields: Object.keys(input) },
    });
    return this.getAsset(actor, asset.id);
  }

  // ===================================================================
  // Movement — AST-CORE-006/007
  // ===================================================================

  /**
   * Move an asset: change its location, its custodian, or both. Absent
   * fields keep their current value; an explicit null clears one.
   *
   * If the tenant has published an `asset_movement_approval` Workflow
   * Definition, the movement is recorded and waits for that lifecycle
   * (AST-CORE-007). Otherwise it applies immediately, transactionally.
   */
  async moveAsset(
    actor: ActorContext,
    id: string,
    input: {
      organizationUnitId?: string | null;
      custodianEmployeeId?: string | null;
      projectId?: string | null;
      siteId?: string | null;
      locationDetail?: string | null;
      reason?: string | null;
      effectiveDate?: string | null;
    },
  ): Promise<AssetDetailView> {
    const change: AssetPlacementChange = {};
    if ("organizationUnitId" in input) {
      change.organizationUnitId = await this.resolveOrganizationUnit(actor, input.organizationUnitId ?? null);
    }
    if ("custodianEmployeeId" in input) {
      change.custodianEmployeeId = await this.resolveCustodian(actor, input.custodianEmployeeId ?? null);
    }
    if ("projectId" in input) change.projectId = await this.resolveProject(actor, input.projectId ?? null);
    if ("siteId" in input) change.siteId = await this.resolveSite(actor, input.siteId ?? null);
    if ("locationDetail" in input) change.locationDetail = input.locationDetail ?? null;

    if (Object.keys(change).length === 0) {
      throw new ValidationError("A movement must change at least one of location, project, site, or custodian");
    }
    return this.submitMovement(actor, id, "transfer", change, input.reason ?? null, input.effectiveDate ?? null);
  }

  /** A status change is the same ledger entry with nothing but status moving,
   * so "where was it / who held it / what state was it in" stays one story. */
  async changeAssetStatus(
    actor: ActorContext,
    id: string,
    input: { status: string; reason?: string | null; effectiveDate?: string | null },
  ): Promise<AssetDetailView> {
    const status = this.parseStatus(input.status);
    if (isTerminalAssetStatus(status)) {
      throw new ValidationError("Use the retirement action to retire or dispose of an asset");
    }
    return this.submitMovement(
      actor,
      id,
      "status_change",
      { status },
      input.reason ?? null,
      input.effectiveDate ?? null,
    );
  }

  /**
   * Retire or dispose of an asset. The record and its whole history stay
   * readable forever — Asset Core has no destructive delete. No financial
   * disposal entry is produced; that is Finance Advanced.
   */
  async retireAsset(
    actor: ActorContext,
    id: string,
    input: { status?: string; reason?: string | null; effectiveDate?: string | null },
  ): Promise<AssetDetailView> {
    const status = this.parseStatus(input.status ?? "retired");
    if (!isTerminalAssetStatus(status)) {
      throw new ValidationError("Retirement status must be 'retired' or 'disposed'");
    }
    return this.submitMovement(
      actor,
      id,
      "status_change",
      { status },
      input.reason ?? null,
      input.effectiveDate ?? null,
    );
  }

  /** Generic lifecycle dispatch for a movement awaiting approval: this
   * service never encodes the Step graph — it forwards the action code and
   * lets the Workflow Engine validate it. An approved movement is applied
   * immediately afterwards, with the same transactional guarantees as an
   * unapproved-tenant movement. */
  async actOnMovement(
    actor: ActorContext,
    movementId: string,
    actionCode: string,
    comment: string | null,
  ): Promise<AssetDetailView> {
    await this.rbac.requirePermission(actor, "asset.read");
    const movement = await this.repo.findMovementById(movementId);
    if (!movement || movement.tenantId !== actor.tenantId) throw new NotFoundError("AssetMovement", movementId);
    const asset = await this.getAuthorizedAsset(actor, movement.assetId);
    if (!movement.workflowInstanceId) throw new ConflictError("This movement has no active Workflow Instance");
    if (movement.appliedAt) throw new ConflictError("This movement has already been applied");

    const { assignments } = await this.workflow.getInstanceForEntityOwner(
      actor.tenantId,
      movement.workflowInstanceId,
    );
    const pending = assignments.find((a) => a.status === "pending");
    if (!pending) throw new ConflictError("No pending action currently exists on this movement");

    await this.workflow.actOnAssignment(actor, pending.id, actionCode, comment);

    const eventType = ACTION_EVENT_MAP[actionCode] ?? "asset.movement.status_changed";
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: eventType,
      entityType: "asset_movement",
      entityId: movement.id,
      metadata: { assetNumber: asset.assetNumber, actionCode, comment },
    });

    const status = await this.workflow.getEntityStatus(actor, movement.workflowInstanceId);
    if (status.instanceStatus === "approved") {
      const applied = await this.repo.applyPendingMovement(movement.id, actor.userId);
      if (!applied) {
        throw new ConflictError(
          "This movement can no longer be applied — the asset has been retired or the movement was already applied",
        );
      }
      await this.recordAppliedMovement(actor, applied.asset, applied.movement);
    } else {
      await this.eventBus.publish({
        tenantId: actor.tenantId,
        eventType,
        entityType: "asset_movement",
        entityId: movement.id,
        payload: {
          assetId: asset.id,
          assetNumber: asset.assetNumber,
          actionCode,
          targetUserId: movement.requestedByUserId,
        },
        createdBy: actor.userId,
      });
    }
    return this.getAsset(actor, asset.id);
  }

  // ===================================================================
  // Document Core authorization hook (AST-CORE-008, ADR-0012)
  // ===================================================================

  /** Asset documents inherit the asset's own authorization: same tenant,
   * a dedicated document capability, AND the asset's Data Scope. */
  async canAccessForDocument(actor: ActorContext, assetId: string): Promise<boolean> {
    const asset = await this.repo.findAssetById(assetId);
    if (!asset || asset.tenantId !== actor.tenantId) return false;
    const permissions = await this.rbac.getActivePermissions(actor);
    if (!permissions.has("asset.documents.read")) return false;
    return this.isWithinOrganizationScope(actor, asset.organizationUnitId);
  }

  // ===================================================================
  // Internals
  // ===================================================================

  /** The one path every placement/status change takes: validate, then either
   * apply transactionally or hand the movement to the configured Workflow. */
  private async submitMovement(
    actor: ActorContext,
    assetId: string,
    movementType: "transfer" | "status_change",
    change: AssetPlacementChange,
    reason: string | null,
    effectiveDate: string | null,
  ): Promise<AssetDetailView> {
    await this.rbac.requirePermission(actor, "asset.move");
    const asset = await this.getAuthorizedAsset(actor, assetId);
    if (isTerminalAssetStatus(asset.status)) {
      throw new ConflictError("A " + asset.status + " asset can no longer be moved");
    }
    const parsedDate = this.parseDate(effectiveDate, "effectiveDate");

    const approvalRequired = await this.isMovementApprovalConfigured(actor);
    if (!approvalRequired) {
      const applied = await this.repo.recordAndApplyMovement({
        tenantId: actor.tenantId,
        assetId: asset.id,
        movementType,
        reason,
        effectiveDate: parsedDate,
        change,
        requestedByUserId: actor.userId,
      });
      if (!applied) throw new ConflictError("This asset can no longer be moved");
      await this.recordAppliedMovement(actor, applied.asset, applied.movement);
      return this.getAsset(actor, asset.id);
    }

    const open = await this.repo.findPendingMovementForAsset(asset.id);
    if (open && open.workflowInstanceId) {
      const openStatus = await this.workflow.getEntityStatus(actor, open.workflowInstanceId);
      if (openStatus.instanceStatus === "in_progress") {
        throw new ConflictError("This asset already has a movement awaiting approval");
      }
    }

    const movement = await this.repo.recordPendingMovement({
      tenantId: actor.tenantId,
      assetId: asset.id,
      movementType,
      reason,
      effectiveDate: parsedDate,
      change,
      requestedByUserId: actor.userId,
    });
    if (!movement) throw new ConflictError("This asset can no longer be moved");

    const { instance } = await this.workflow.startInstance(actor, {
      definitionCode: ASSET_MOVEMENT_WORKFLOW_DEFINITION_CODE,
      entityId: movement.id,
      contextData: {
        assetId: asset.id,
        assetNumber: asset.assetNumber,
        movementType,
        organizationUnitId: asset.organizationUnitId,
      },
    });
    await this.repo.setMovementWorkflowInstance(movement.id, instance.id);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "asset.movement.requested",
      entityType: "asset_movement",
      entityId: movement.id,
      metadata: { assetNumber: asset.assetNumber, movementType, change },
    });
    return this.getAsset(actor, asset.id);
  }

  /** Audit + event for a movement that actually took effect. */
  private async recordAppliedMovement(
    actor: ActorContext,
    asset: Asset,
    movement: AssetMovement,
  ): Promise<void> {
    const retired = isTerminalAssetStatus(asset.status);
    const action = retired
      ? "asset.retired"
      : movement.movementType === "status_change"
        ? "asset.status.changed"
        : "asset.moved";

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action,
      entityType: "asset",
      entityId: asset.id,
      metadata: {
        assetNumber: asset.assetNumber,
        movementId: movement.id,
        sequence: movement.sequence,
        fromSiteId: movement.fromSiteId,
        toSiteId: movement.toSiteId,
        fromStatus: movement.fromStatus,
        toStatus: movement.toStatus,
      },
    });
    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: action,
      entityType: "asset",
      entityId: asset.id,
      payload: {
        assetNumber: asset.assetNumber,
        movementId: movement.id,
        toStatus: movement.toStatus,
        // Reuses Notification Core's recipient convention; no Asset
        // messaging system exists. Only meaningful for an approved
        // movement someone else requested.
        targetUserId: movement.requestedByUserId,
      },
      createdBy: actor.userId,
    });
  }

  private async describeMovement(actor: ActorContext, movement: AssetMovement): Promise<AssetMovementView> {
    if (!movement.workflowInstanceId) return { movement, status: null, availableActions: [] };
    const status = await this.workflow.getEntityStatus(actor, movement.workflowInstanceId);
    const view = await this.workflow.getEntityWorkflowView(actor, movement.workflowInstanceId);
    return {
      movement,
      status: { stepCode: status.stepCode, stepName: status.stepName, instanceStatus: status.instanceStatus },
      availableActions: view.availableActions ?? [],
    };
  }

  /** AST-CORE-007 is explicitly conditional — "where the client requires
   * one". A published Definition IS that requirement; its absence means the
   * client wants direct movement. */
  private async isMovementApprovalConfigured(actor: ActorContext): Promise<boolean> {
    const view = await this.workflow.getDefinitionView(
      actor.tenantId,
      ASSET_MOVEMENT_WORKFLOW_DEFINITION_CODE,
    );
    return !!view && view.definition.isActive && view.versionNumber !== null;
  }

  private normaliseTag(tag: string | null | undefined): string | null {
    if (tag === null || tag === undefined) return null;
    const trimmed = tag.trim();
    return trimmed === "" ? null : trimmed;
  }

  private parseStatus(value: string): AssetStatus {
    if (!ASSET_STATUSES.includes(value as AssetStatus)) {
      throw new ValidationError("status must be one of: " + ASSET_STATUSES.join(", "));
    }
    return value as AssetStatus;
  }

  private parseDate(value: string | null | undefined, field: string): string | null {
    if (value === null || value === undefined || value === "") return null;
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      if (Number.isNaN(new Date(trimmed + "T00:00:00Z").getTime())) {
        throw new ValidationError(field + " is not a valid date");
      }
      return trimmed;
    }
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) throw new ValidationError(field + " is not a valid date");
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  private async resolveOrganizationUnit(actor: ActorContext, unitId: string | null): Promise<string | null> {
    if (!unitId) return null;
    if (!(await this.repo.organizationUnitExists(actor.tenantId, unitId))) {
      throw new NotFoundError("OrganizationUnit", unitId);
    }
    // Moving an asset INTO a unit the actor cannot see would put it beyond
    // their own reach and outside their authority — refuse it (§32).
    await this.rbac.requireOrganizationUnitScopeForActor(actor, unitId);
    return unitId;
  }

  private async resolveProject(actor: ActorContext, projectId: string | null): Promise<string | null> {
    if (!projectId) return null;
    if (!(await this.repo.projectExists(actor.tenantId, projectId))) throw new NotFoundError("Project", projectId);
    return projectId;
  }

  private async resolveSite(actor: ActorContext, siteId: string | null): Promise<string | null> {
    if (!siteId) return null;
    if (!(await this.repo.siteExists(actor.tenantId, siteId))) throw new NotFoundError("Site", siteId);
    return siteId;
  }

  /** Cross-tenant custodians are simply not found — Asset never reaches into
   * another tenant's people, and never copies their data onto the asset. */
  private async resolveCustodian(actor: ActorContext, employeeId: string | null): Promise<string | null> {
    if (!employeeId) return null;
    const custodian = await this.repo.findCustodianReference(actor.tenantId, employeeId);
    if (!custodian) throw new NotFoundError("Employee", employeeId);
    return custodian.id;
  }

  private async getAuthorizedAsset(actor: ActorContext, id: string): Promise<Asset> {
    const asset = await this.repo.findAssetById(id);
    if (!asset || asset.tenantId !== actor.tenantId) throw new NotFoundError("Asset", id);
    if (!(await this.isWithinOrganizationScope(actor, asset.organizationUnitId))) {
      throw new ForbiddenError("Your assigned Data Scope does not cover this asset");
    }
    return asset;
  }

  /**
   * An asset with no Organization Unit is tenant-level; one placed in a unit
   * is visible only within that unit's hierarchical scope (AST-CORE-009).
   *
   * Deliberate history policy (§33): access to an asset's movement history
   * follows access to the asset itself, anchored on its CURRENT responsible
   * unit. History is never exposed tenant-wide to someone who cannot see the
   * asset it belongs to.
   */
  private async isWithinOrganizationScope(actor: ActorContext, unitId: string | null): Promise<boolean> {
    if (!unitId) return true;
    return this.rbac.isActiveOrganizationUnitScopeCovered(actor, unitId);
  }

  private async filterByOrganizationScope(actor: ActorContext, assets: Asset[]): Promise<Asset[]> {
    if (await this.rbac.hasTenantScope(actor)) return assets;
    const decisions = new Map<string, boolean>();
    const allowed: Asset[] = [];
    for (const asset of assets) {
      if (!asset.organizationUnitId) {
        allowed.push(asset);
        continue;
      }
      let ok = decisions.get(asset.organizationUnitId);
      if (ok === undefined) {
        ok = await this.rbac.isActiveOrganizationUnitScopeCovered(actor, asset.organizationUnitId);
        decisions.set(asset.organizationUnitId, ok);
      }
      if (ok) allowed.push(asset);
    }
    return allowed;
  }
}
