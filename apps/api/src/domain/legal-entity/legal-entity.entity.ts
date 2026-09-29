import type { ActorContext } from "../shared-kernel/audit-context.js";

/**
 * Epic 5 Gelombang 1 (§4.5 Putaran 6) — the Legal Entity lifecycle enum.
 *
 * G0 contract `docs/plans/epic-5-g0-contract.md` §5: `is_active` stays in the
 * table for backward compatibility, but `status` is authoritative and the two
 * are pinned together by `legal_entities_status_is_active_check`
 * (`is_active = (status = 'active')`). Code reads `status`.
 */
export type LifecycleStatus = "draft" | "active" | "inactive" | "tombstone" | "deleted";

/** Declared once so the route schema, the repository and the tests all name
 * the same five values the CHECK constraint names. */
export const LIFECYCLE_STATUSES: readonly LifecycleStatus[] = [
  "draft",
  "active",
  "inactive",
  "tombstone",
  "deleted",
];

/** §4.5 Putaran 3: multi-address by type. The four types the CHECK constraint
 * allows; additional types are an additive change to that list, not something
 * this wave invents. */
export type LegalEntityAddressType = "registered" | "operating" | "billing" | "tax";

export const LEGAL_ENTITY_ADDRESS_TYPES: readonly LegalEntityAddressType[] = [
  "registered",
  "operating",
  "billing",
  "tax",
];

export interface LegalEntity {
  id: string;
  tenantId: string;
  name: string;
  registrationNo: string | null;
  /** Tenant-facing trade name (§4.5 Putaran 2). */
  displayName: string | null;
  country: string | null;
  timezone: string | null;
  baseCurrency: string | null;
  email: string | null;
  phone: string | null;
  status: LifecycleStatus;
  isActive: boolean;
  deactivatedAt: Date | null;
  deactivatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLegalEntityInput {
  tenantId: string;
  name: string;
  registrationNo?: string | null;
  displayName?: string | null;
  country?: string | null;
  timezone?: string | null;
  baseCurrency?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Lifecycle state to create in. Omitted by the HTTP surface today, which
   * creates every Legal Entity as `draft`; the atomic creation path fills its
   * own Central root regardless of the state it starts in. */
  status?: LifecycleStatus;
}

export interface UpdateLegalEntityInput {
  name: string;
  registrationNo?: string | null;
  displayName?: string | null;
  country?: string | null;
  timezone?: string | null;
  baseCurrency?: string | null;
  email?: string | null;
  phone?: string | null;
}

/**
 * §4.5 Putaran 3 — one Legal Entity holds several typed addresses. Addresses
 * belong to the Legal Entity aggregate: they share its repository and its
 * container key, so an address can never be written without the owning Legal
 * Entity being resolved in the same transaction.
 *
 * Ownership is a database fact: the composite FK
 * `(tenant_id, legal_entity_id) → legal_entities(tenant_id, id)` makes a
 * cross-tenant address row unrepresentable. The repository states the same
 * rule one layer up so the failure is a `NotFoundError` instead of a
 * constraint violation.
 */
export interface LegalEntityAddress {
  id: string;
  tenantId: string;
  legalEntityId: string;
  addressType: LegalEntityAddressType;
  line1: string;
  line2: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  isActive: boolean;
  deactivatedAt: Date | null;
  deactivatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLegalEntityAddressInput {
  addressType: LegalEntityAddressType;
  line1: string;
  line2?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

export interface UpdateLegalEntityAddressInput {
  line1?: string;
  line2?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

export interface LifecycleActor {
  userId: string;
  tenantId: string;
}

export interface LegalEntityRepository {
  /** Atomic creation: the Legal Entity and its one Central root Organization
   * Unit are inserted in the SAME governed transaction, so a Legal Entity
   * without a root Central cannot exist (§4.5 Putaran 4, roadmap step 8). */
  create(input: CreateLegalEntityInput, actor: ActorContext): Promise<LegalEntity>;
  findById(id: string): Promise<LegalEntity | null>;
  listByTenant(tenantId: string): Promise<LegalEntity[]>;
  update(id: string, input: UpdateLegalEntityInput, actor: ActorContext): Promise<LegalEntity>;
  setActive(id: string, isActive: boolean, actor: ActorContext): Promise<LegalEntity>;
  /**
   * Lifecycle transition with the G0 §5 policy applied explicitly:
   * `draft → active`, `active → inactive`, `inactive → active`,
   * `inactive → tombstone`. Anything else is a `ConflictError` naming the
   * attempted transition. `is_active` is derived from the target status so the
   * `legal_entities_status_is_active_check` constraint always holds.
   */
  updateStatus(id: string, status: LifecycleStatus, actor: ActorContext): Promise<LegalEntity>;

  listAddresses(legalEntityId: string, actor: ActorContext): Promise<LegalEntityAddress[]>;
  createAddress(
    legalEntityId: string,
    input: CreateLegalEntityAddressInput,
    actor: ActorContext,
  ): Promise<LegalEntityAddress>;
  updateAddress(
    legalEntityId: string,
    addressId: string,
    input: UpdateLegalEntityAddressInput,
    actor: ActorContext,
  ): Promise<LegalEntityAddress>;
  deactivateAddress(
    legalEntityId: string,
    addressId: string,
    actor: ActorContext,
  ): Promise<LegalEntityAddress>;
}
