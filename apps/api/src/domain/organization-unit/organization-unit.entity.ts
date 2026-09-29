import type { ActorContext } from "../shared-kernel/audit-context.js";
import type { LifecycleStatus } from "../legal-entity/legal-entity.entity.js";

/**
 * Epic 5 Gelombang 1 (§4.5 Putaran 2) — the platform core set for
 * `organization_units.unit_type`.
 *
 * Locked decision: "Jenis inti dan aturan hierarchy dikunci platform; Tenant
 * boleh mengganti label lewat terminology yang diizinkan." The platform set is
 * the one the target model draws — `Central → Region → Internal Site/Branch` —
 * and 1789360000000 adds the CHECK that closes `unit_type` to exactly these
 * three values for every new write. The tenant's own wording is stored in
 * `unit_type_label`, never in `unit_type`.
 *
 * Existing rows whose `unit_type` was free text are NOT rewritten by this wave:
 * the guard for Gelombang 1 inventories legacy values and reports them to the
 * Founder instead of reclassifying them, so 1789360000000 adds its CHECK
 * `NOT VALID` and grandfathers the spellings that are already stored. A stored
 * value that is not one of the core types therefore stays readable and
 * editable, and this constant is only what a *writer* may state.
 */
export const ORGANIZATION_UNIT_TYPES = ["Central", "Region", "Internal Site"] as const;

export type OrganizationUnitType = (typeof ORGANIZATION_UNIT_TYPES)[number];

export function isOrganizationUnitType(value: string): value is OrganizationUnitType {
  return (ORGANIZATION_UNIT_TYPES as readonly string[]).includes(value);
}

export interface OrganizationUnit {
  id: string;
  tenantId: string;
  legalEntityId: string;
  parentId: string | null;
  name: string;
  unitType: string;
  /** Tenant-facing wording for the unit, when it differs from the platform
   * core type. NULL means "call it whatever the core type says". */
  unitTypeLabel: string | null;
  status: LifecycleStatus;
  /** §4.5 Putaran 4 — optional replacement reference. Written by Gelombang 2's
   * tombstone/replacement flow; Wave 1 only carries it. */
  replacementOrganizationUnitId: string | null;
  /** Per-unit override (§4.5 Putaran 3). NULL inherits from the Legal Entity,
   * which inherits from the Tenant. */
  timezone: string | null;
  isActive: boolean;
  deactivatedAt: Date | null;
  deactivatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrganizationUnitInput {
  tenantId: string;
  legalEntityId: string;
  parentId?: string | null;
  name: string;
  unitType?: string;
  timezone?: string | null;
  replacementOrganizationUnitId?: string | null;
}

export interface UpdateOrganizationUnitInput {
  name: string;
  unitType?: string;
  timezone?: string | null;
}

export interface LifecycleActor {
  userId: string;
  tenantId: string;
}

export interface OrganizationUnitRepository {
  create(input: CreateOrganizationUnitInput, actor: ActorContext): Promise<OrganizationUnit>;
  findById(id: string): Promise<OrganizationUnit | null>;
  listByTenant(tenantId: string): Promise<OrganizationUnit[]>;
  /**
   * Checkpoint 0F / ADR-0009 (Hierarchical Data Scope, supersedes
   * ADR-0005's exact-match-only rule): every ancestor Organization Unit
   * id of `id`, INCLUDING `id` itself, walking up `parent_id` to the
   * root. A Data Scope assignment on any of these ids covers `id` — this
   * is the one place that upward walk is computed, reused by both
   * `RbacService` (permission checks) and `RbacRepository`
   * (role+scope queue resolution) so the two can never drift.
   */
  listAncestorIds(id: string): Promise<string[]>;
  update(id: string, input: UpdateOrganizationUnitInput, actor: ActorContext): Promise<OrganizationUnit>;
  setActive(id: string, isActive: boolean, actor: ActorContext): Promise<OrganizationUnit>;
  /** Lifecycle transition, same policy shape as the Legal Entity one
   * (G0 §5): `draft → active`, `active → inactive`, `inactive → active`,
   * `inactive → tombstone`; anything else is a `ConflictError` naming the
   * attempted transition, and the root Central never moves at all. */
  updateStatus(
    id: string,
    status: LifecycleStatus,
    actor: ActorContext,
  ): Promise<OrganizationUnit>;
}
