import type { ActorContext } from "../shared-kernel/audit-context.js";

/**
 * Epic 5 Gelombang 2 (§4.5 steps 10–13) — effective-dated hierarchy history,
 * change requests and the tombstone/reference-check flow.
 *
 * §4.5 principle 7 fixes the model: "Parent-child harus memiliki range effective
 * date, tidak hanya satu `parent_id` current." One `parent_id` per unit cannot
 * answer "which parent did this site have on 2026-08-01", and the roadmap's
 * reporting gate needs exactly that answer.
 *
 * §4.5 principle 8 fixes what a change must carry: "Backdate hierarchy wajib
 * menyimpan effective date, recorded/published date, actor, reason, dan dampak.
 * Audit tidak pernah di-backdate." `effectiveFrom` is a business date; every
 * write also records when it was actually published, and the two are never
 * conflated.
 *
 * §4.5 principle 12 fixes who may do what: "Proposal bukan publish. Admin Tenant
 * dapat menyusun draft perubahan dalam batasnya; hanya Super Admin dapat
 * menerbitkan perubahan struktur." This codebase has no separate Super-Admin
 * flag — authority is a Role permission granted from the assignment that also
 * carries the Data Scope — so "Super Admin" is the holder of
 * `organization_unit.change_request.review`, and nothing else in this module
 * treats the actor as privileged.
 */

/** The status set of a change request. Q7 of the G0 contract asked whether
 * `pending_review` exists; it does, and `cancelled` does too — see the seed
 * migration 1789397000000 for why collapsing them into `draft` would make one
 * word mean two different things. */
export const CHANGE_REQUEST_STATUSES = [
  "draft",
  "pending_review",
  "published",
  "rejected",
  "cancelled",
] as const;

export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];

/** §4.5 Putaran 6: what an Admin Tenant may propose is "hierarchy Organization
 * Unit, inactive/delete request, code change request, dan profil Legal Entity
 * penting". Gelombang 2 owns the first two; the code-change and Legal Entity
 * profile proposals are later waves and are not representable here yet. */
export const CHANGE_REQUEST_ACTIONS = ["move", "tombstone"] as const;

export type ChangeRequestAction = (typeof CHANGE_REQUEST_ACTIONS)[number];

export interface HierarchyHistoryEntry {
  id: string;
  tenantId: string;
  organizationUnitId: string;
  parentOrganizationUnitId: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  publishedAt: Date;
  publishedBy: string | null;
  reason: string;
  changeRequestId: string | null;
}

export interface OrganizationUnitChangeRequest {
  id: string;
  tenantId: string;
  organizationUnitId: string;
  requestedAction: ChangeRequestAction;
  proposedParentOrganizationUnitId: string | null;
  requestedReplacementOrganizationUnitId: string | null;
  requestedEffectiveFrom: Date;
  reason: string;
  status: ChangeRequestStatus;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  proposedByUserId: string;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  reviewReason: string | null;
  publishedAt: Date | null;
  historyId: string | null;
  createdAt: Date;
}

export interface ReferenceHit {
  table: string;
  column: string;
  count: number;
}

export interface CreateChangeRequestInput {
  organizationUnitId: string;
  requestedAction: ChangeRequestAction;
  proposedParentOrganizationUnitId?: string | null;
  requestedReplacementOrganizationUnitId?: string | null;
  requestedEffectiveFrom: Date;
  reason: string;
  /** `true` moves the new request straight to `pending_review`: the proposer
   * states it is ready for the Super Admin. A draft is the proposer's own
   * scratch space and never reaches a reviewer. */
  submitForReview?: boolean;
}

export interface TombstoneInput {
  replacementOrganizationUnitId?: string | null;
  reason: string;
  /** Business date the unit stops being in force. Defaults to now when the
   * caller does not state one. */
  effectiveFrom?: Date;
}

export interface TombstoneResult {
  organizationUnitId: string;
  status: "tombstone";
  tombstonedAt: Date;
  replacementOrganizationUnitId: string | null;
  /** §4.5 principle 6: "Physical delete hanya mungkin bila seluruh pemeriksaan
   * referensi membuktikan entity tidak pernah dipakai." This is that
   * measurement, reported rather than acted on — Epic 5 performs no physical
   * delete, so an eligible unit is tombstoned like any other and the census is
   * what tells an operator (and the audit trail) that nothing referenced it. */
  references: ReferenceHit[];
  eligibleForPhysicalDelete: boolean;
}

export interface PublishResult {
  request: OrganizationUnitChangeRequest;
  /** The projection after the publish. For `move` this is the new `parent_id`;
   * for `tombstone` the unit's status. */
  organizationUnit: {
    id: string;
    parentId: string | null;
    status: string;
    replacementOrganizationUnitId: string | null;
  };
  /** §4.5 G: a publish whose business date precedes its recording date is a
   * backdate, and the difference must be visible on the record — never hidden
   * by rewriting the recording time. */
  backdated: boolean;
  effectiveFrom: Date;
  publishedAt: Date;
}

export interface OrganizationUnitHierarchyRepository {
  createChangeRequest(
    input: CreateChangeRequestInput,
    actor: ActorContext,
  ): Promise<OrganizationUnitChangeRequest>;
  listChangeRequests(
    tenantId: string,
    filter?: { organizationUnitId?: string; status?: ChangeRequestStatus },
  ): Promise<OrganizationUnitChangeRequest[]>;
  findChangeRequest(id: string): Promise<OrganizationUnitChangeRequest | null>;
  publishChangeRequest(id: string, actor: ActorContext): Promise<PublishResult>;
  rejectChangeRequest(
    id: string,
    reviewReason: string,
    actor: ActorContext,
  ): Promise<OrganizationUnitChangeRequest>;
  cancelChangeRequest(id: string, actor: ActorContext): Promise<OrganizationUnitChangeRequest>;
  /** §4.5 principle 7's read: the full parent-child history of a unit, or the
   * version in force at `at`. */
  listHistory(organizationUnitId: string, at?: Date): Promise<HierarchyHistoryEntry[]>;
  parentAt(organizationUnitId: string, at: Date): Promise<string | null>;
  tombstoneUnit(
    organizationUnitId: string,
    input: TombstoneInput,
    actor: ActorContext,
  ): Promise<TombstoneResult>;
  referenceCensus(entityType: "organization_unit" | "legal_entity", entityId: string): Promise<ReferenceHit[]>;
}

/**
 * §4.5 G — "Batas maksimal jumlah hari backdate hierarchy ... Parameter policy
 * Epic 8". Epic 8 owns the parameter, and it does not exist yet, so this is the
 * platform default the wave ships with: the only thing the code must NOT do is
 * let a backdate arrive without a bound. Named and exported so the policy module
 * can replace the number without hunting for it.
 */
export const ORGANIZATION_UNIT_BACKDATE_LIMIT_DAYS = 90;
