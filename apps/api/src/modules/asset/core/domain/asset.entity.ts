/**
 * Asset Core — domain types (Phase 5).
 *
 * Built under the frozen target repository architecture
 * (`modules/<module>/core/{domain,application,infrastructure,api}`).
 *
 * Scope discipline: Core is a REGISTER. It answers *what asset exists, what
 * is its identity/tag, where is it, who is responsible for it, what is its
 * status, and how did it move*. It contains no preventive/corrective
 * maintenance, work order, meter reading, downtime, MTBF/MTTR, spare-part
 * consumption, predictive/condition monitoring, depreciation, or fixed-asset
 * accounting concept — all of those are Advanced Asset capabilities.
 */

/**
 * Finite Core lifecycle values. They drive behaviour (a retired or disposed
 * asset can no longer move), so they are NOT Tenant Configuration —
 * the same rule Workforce applies to `EmploymentStatus`. Asset CATEGORY is
 * the configurable dimension instead.
 *
 * Maintenance conditions (under repair, maintenance due, breakdown) are
 * deliberately absent: they belong to Asset Advanced (Maintenance), not to
 * the register.
 */
export type AssetStatus = "in_use" | "idle" | "retired" | "disposed";

export const ASSET_STATUSES: AssetStatus[] = ["in_use", "idle", "retired", "disposed"];

/** Terminal statuses: the asset stays readable forever, but stops moving. */
export const TERMINAL_ASSET_STATUSES: AssetStatus[] = ["retired", "disposed"];

export function isTerminalAssetStatus(status: AssetStatus): boolean {
  return TERMINAL_ASSET_STATUSES.includes(status);
}

/** A movement that only changes status is recorded as such so audit and
 * history stay legible; anything touching placement is a transfer. */
export type AssetMovementType = "transfer" | "status_change";

export interface Asset {
  id: string;
  tenantId: string;
  /** Minted by Numbering Core — always present (AST-CORE-001). */
  assetNumber: string;
  /** OPTIONAL physical identifier; unique per tenant when present. */
  assetTag: string | null;
  name: string;
  description: string | null;
  category: string | null;
  status: AssetStatus;
  /** Responsible organisation unit — also the Data Scope anchor. */
  organizationUnitId: string | null;
  /** Optional named custodian. Referenced by id only; Asset never copies
   * workforce personal data onto itself. */
  custodianEmployeeId: string | null;
  projectId: string | null;
  siteId: string | null;
  locationDetail: string | null;
  acquisitionReference: string | null;
  acquiredAt: string | null;
  /** Incremented by every applied movement; pairs with movement sequence. */
  version: number;
  retiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One row of the immutable movement ledger (AST-CORE-006).
 *
 * `requestedChange` is what was asked for; the `from*`/`to*` fields are the
 * resolved facts, written once when the movement is applied. A movement
 * awaiting approval has `appliedAt === null` and no resolved snapshot yet.
 */
export interface AssetMovement {
  id: string;
  tenantId: string;
  assetId: string;
  sequence: number | null;
  movementType: AssetMovementType;
  reason: string | null;
  effectiveDate: string | null;
  requestedChange: AssetPlacementChange;
  fromOrganizationUnitId: string | null;
  fromCustodianEmployeeId: string | null;
  fromProjectId: string | null;
  fromSiteId: string | null;
  fromLocationDetail: string | null;
  fromStatus: AssetStatus | null;
  toOrganizationUnitId: string | null;
  toCustodianEmployeeId: string | null;
  toProjectId: string | null;
  toSiteId: string | null;
  toLocationDetail: string | null;
  toStatus: AssetStatus | null;
  /** The ONE link to the generic Workflow Engine (AST-CORE-007). */
  workflowInstanceId: string | null;
  requestedByUserId: string | null;
  appliedAt: Date | null;
  appliedByUserId: string | null;
  createdAt: Date;
}

/**
 * A partial placement change. An ABSENT key means "keep whatever the asset
 * currently has"; an explicit `null` means "clear it". The distinction
 * matters because a movement may sit awaiting approval while the asset
 * legitimately moves for another reason.
 */
export interface AssetPlacementChange {
  organizationUnitId?: string | null;
  custodianEmployeeId?: string | null;
  projectId?: string | null;
  siteId?: string | null;
  locationDetail?: string | null;
  status?: AssetStatus;
}

/** Minimal, privacy-conscious projection of a custodian. Asset never reads
 * or exposes employment, contact, or any other workforce detail. */
export interface CustodianReference {
  id: string;
  employeeNumber: string;
  fullName: string;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CreateAssetInput {
  tenantId: string;
  assetNumber: string;
  assetTag: string | null;
  name: string;
  description: string | null;
  category: string | null;
  status: AssetStatus;
  organizationUnitId: string | null;
  custodianEmployeeId: string | null;
  projectId: string | null;
  siteId: string | null;
  locationDetail: string | null;
  acquisitionReference: string | null;
  acquiredAt: string | null;
  createdBy: string | null;
}

export interface UpdateAssetInput {
  assetTag?: string | null;
  name?: string;
  description?: string | null;
  category?: string | null;
  acquisitionReference?: string | null;
  acquiredAt?: string | null;
}

export interface RecordMovementInput {
  tenantId: string;
  assetId: string;
  movementType: AssetMovementType;
  reason: string | null;
  effectiveDate: string | null;
  change: AssetPlacementChange;
  requestedByUserId: string | null;
  /** When set, the movement is recorded but NOT applied: it waits for the
   * configured approval lifecycle to reach an approved terminal state. */
  workflowInstanceId?: string | null;
}

export interface AssetListFilter {
  search?: string;
  category?: string;
  status?: AssetStatus;
  organizationUnitId?: string;
  siteId?: string;
  custodianEmployeeId?: string;
  includeTerminal?: boolean;
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

export interface AssetRepository {
  // --- Asset master (AST-CORE-001…005) --------------------------------
  createAsset(input: CreateAssetInput): Promise<Asset>;
  findAssetById(id: string): Promise<Asset | null>;
  findAssetByNumber(tenantId: string, assetNumber: string): Promise<Asset | null>;
  findAssetByTag(tenantId: string, assetTag: string): Promise<Asset | null>;
  listAssets(tenantId: string, filter: AssetListFilter): Promise<Asset[]>;
  /** Descriptive fields only. Placement and status NEVER change here —
   * they only change through a movement, so history is never bypassed. */
  updateAsset(id: string, input: UpdateAssetInput, updatedBy: string | null): Promise<Asset | null>;

  // --- Movement ledger (AST-CORE-006/007) ------------------------------
  /**
   * Records the movement AND applies it to the asset inside ONE database
   * transaction: the asset row is locked, the real previous state is
   * snapshotted, the new state is written, and the asset version is bumped
   * to the movement's sequence. Two concurrent transfers therefore produce
   * an unbroken history chain and never a lost update.
   *
   * Returns null when the asset has already reached a terminal status —
   * in which case NOTHING is written.
   */
  recordAndApplyMovement(input: RecordMovementInput): Promise<{ asset: Asset; movement: AssetMovement } | null>;
  /**
   * Records a movement that must wait for approval. No asset state changes
   * and no sequence is assigned.
   */
  recordPendingMovement(input: RecordMovementInput): Promise<AssetMovement | null>;
  /**
   * Applies a previously recorded, approved movement. Same transactional
   * and locking guarantees as `recordAndApplyMovement`; returns null when
   * the movement was already applied or the asset has since become
   * terminal.
   */
  applyPendingMovement(
    movementId: string,
    appliedBy: string | null,
  ): Promise<{ asset: Asset; movement: AssetMovement } | null>;
  findMovementById(id: string): Promise<AssetMovement | null>;
  listMovements(assetId: string): Promise<AssetMovement[]>;
  findPendingMovementForAsset(assetId: string): Promise<AssetMovement | null>;
  setMovementWorkflowInstance(id: string, workflowInstanceId: string): Promise<void>;

  // --- Cross-domain reads kept behind this port ------------------------
  organizationUnitExists(tenantId: string, organizationUnitId: string): Promise<boolean>;
  projectExists(tenantId: string, projectId: string): Promise<boolean>;
  siteExists(tenantId: string, siteId: string): Promise<boolean>;
  /**
   * Narrow, read-only custodian projection. Asset Core deliberately does
   * NOT import Workforce internals: it reads three identifying fields
   * through its own port so the modules stay independently deployable and
   * no workforce personal data leaks into Asset payloads.
   */
  findCustodianReference(tenantId: string, employeeId: string): Promise<CustodianReference | null>;
  listCustodianReferences(tenantId: string, employeeIds: string[]): Promise<CustodianReference[]>;
}
