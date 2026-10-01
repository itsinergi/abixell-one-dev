import type { ActorContext } from "../shared-kernel/audit-context.js";

/**
 * Business Partner — canonical party model (Epic 6 §4.6).
 *
 * A Business Partner is the universal "who" of the system: an Individual
 * (employee, customer contact, vendor representative) or an Organization
 * (customer company, vendor, service provider, outsourcing provider).
 * Every entity that represents a real-world party links to a BP rather than
 * owning its own person/company table.
 *
 * A Business Partner is not an authorization scope. Permissions gate CRUD on
 * BP records, but DataScope has no business-partner variant. Scope continues
 * through existing scope types such as organization_unit, legal_entity, and
 * customer.
 *
 * Lifecycle: draft → active → inactive → tombstone → deleted. Tombstones stay
 * resolvable for historical references. `bpType` is immutable after creation.
 */

export type BpType = "individual" | "organization";

export const BP_TYPES: readonly BpType[] = ["individual", "organization"];

export type BpLifecycleStatus =
  | "draft"
  | "active"
  | "inactive"
  | "tombstone"
  | "deleted";

export const BP_LIFECYCLE_STATUSES: readonly BpLifecycleStatus[] = [
  "draft",
  "active",
  "inactive",
  "tombstone",
  "deleted",
];

/** Allowed lifecycle transitions. Checked by the application service. */
export const BP_LIFECYCLE_TRANSITIONS: Record<
  BpLifecycleStatus,
  readonly BpLifecycleStatus[]
> = {
  draft: ["active", "deleted"],
  active: ["inactive", "tombstone", "deleted"],
  inactive: ["active", "tombstone", "deleted"],
  tombstone: [],
  deleted: [],
};

export type BpRoleType =
  | "employee"
  | "customer"
  | "vendor"
  | "service_provider"
  | "outsourcing_provider"
  | "salesperson"
  | "prospect";

export const BP_ROLE_TYPES: readonly BpRoleType[] = [
  "employee",
  "customer",
  "vendor",
  "service_provider",
  "outsourcing_provider",
  "salesperson",
  "prospect",
];

export type BpRoleStatus = "active" | "inactive";

export const BP_ROLE_STATUSES: readonly BpRoleStatus[] = ["active", "inactive"];

export interface BusinessPartner {
  id: string;
  tenantId: string;
  code: string;
  bpType: BpType;
  name: string;
  bpGroupId: string | null;
  lifecycleStatus: BpLifecycleStatus;
  isActive: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedBy: string | null;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
}

export interface CreateBusinessPartnerInput {
  code: string;
  bpType: BpType;
  name: string;
  bpGroupId?: string | null;
}

export interface UpdateBusinessPartnerInput {
  name?: string;
  bpGroupId?: string | null;
}

export interface BpRole {
  id: string;
  tenantId: string;
  businessPartnerId: string;
  roleType: BpRoleType;
  status: BpRoleStatus;
  roleNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBpRoleInput {
  roleType: BpRoleType;
  roleNumber?: string | null;
}

export interface UpdateBpRoleInput {
  status?: BpRoleStatus;
  roleNumber?: string | null;
}

export interface ListBpOptions {
  lifecycleStatus?: BpLifecycleStatus;
  bpType?: BpType;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface BusinessPartnerRepository {
  findById(tenantId: string, id: string): Promise<BusinessPartner | null>;
  findByCode(tenantId: string, code: string): Promise<BusinessPartner | null>;
  listByTenant(tenantId: string, options?: ListBpOptions): Promise<BusinessPartner[]>;
  create(
    tenantId: string,
    input: CreateBusinessPartnerInput,
    actor: ActorContext,
  ): Promise<BusinessPartner>;
  update(
    tenantId: string,
    id: string,
    input: UpdateBusinessPartnerInput,
    actor: ActorContext,
  ): Promise<BusinessPartner>;
  setLifecycleStatus(
    tenantId: string,
    id: string,
    currentStatus: BpLifecycleStatus,
    targetStatus: BpLifecycleStatus,
    actor: ActorContext,
    permissionCode?: string,
  ): Promise<BusinessPartner>;

  findRoleById(
    tenantId: string,
    businessPartnerId: string,
    roleId: string,
  ): Promise<BpRole | null>;
  listRoles(tenantId: string, businessPartnerId: string): Promise<BpRole[]>;
  addRole(
    tenantId: string,
    businessPartnerId: string,
    input: CreateBpRoleInput,
    actor: ActorContext,
  ): Promise<BpRole>;
  updateRole(
    tenantId: string,
    businessPartnerId: string,
    roleId: string,
    input: UpdateBpRoleInput,
    actor: ActorContext,
  ): Promise<BpRole>;
  removeRole(
    tenantId: string,
    businessPartnerId: string,
    roleId: string,
    actor: ActorContext,
  ): Promise<void>;
}
