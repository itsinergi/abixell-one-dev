import type {
  BusinessPartner,
  BusinessPartnerRepository,
  BpLifecycleStatus,
  CreateBpRoleInput,
  UpdateBpRoleInput,
  CreateBusinessPartnerInput,
  UpdateBusinessPartnerInput,
} from "../../domain/business-partner/business-partner.entity.js";
import {
  BP_LIFECYCLE_TRANSITIONS,
  BP_ROLE_STATUSES,
  BP_ROLE_TYPES,
  BP_TYPES,
} from "../../domain/business-partner/business-partner.entity.js";
import { ConflictError, NotFoundError } from "../../domain/shared-kernel/errors.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import type { RbacService } from "../rbac/rbac.service.js";

/**
 * Business Partner application service (Epic 6 Gelombang 1).
 *
 * Rules:
 * - BP code unique per tenant (enforced by DB, surfaced as ConflictError).
 * - `bp_type` immutable after creation.
 * - Lifecycle transitions follow `BP_LIFECYCLE_TRANSITIONS`.
 * - Role flags are independent; a BP may have multiple roles.
 * - BP must exist before User/Employee/Customer/Vendor/Contact references it.
 */
export class BusinessPartnerService {
  constructor(
    private readonly repo: BusinessPartnerRepository,
    private readonly rbac: RbacService,
  ) {}

  async list(actor: ActorContext, filters?: {
    lifecycleStatus?: BpLifecycleStatus;
    bpType?: "individual" | "organization";
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    await this.rbac.requirePermission(actor, "business_partner.read");
    return this.repo.listByTenant(actor.tenantId, filters);
  }

  async getById(actor: ActorContext, id: string): Promise<BusinessPartner> {
    await this.rbac.requirePermission(actor, "business_partner.read");
    const bp = await this.repo.findById(actor.tenantId, id);
    if (!bp) throw new NotFoundError("BusinessPartner", id);
    return bp;
  }

  async create(
    actor: ActorContext,
    input: CreateBusinessPartnerInput,
  ): Promise<BusinessPartner> {
    await this.rbac.requirePermission(actor, "business_partner.create");
    this.validateType(input.bpType);
    return this.repo.create(actor.tenantId, input, actor);
  }

  async update(
    actor: ActorContext,
    id: string,
    input: UpdateBusinessPartnerInput,
  ): Promise<BusinessPartner> {
    await this.rbac.requirePermission(actor, "business_partner.update");
    return this.repo.update(actor.tenantId, id, input, actor);
  }

  async activate(actor: ActorContext, id: string): Promise<BusinessPartner> {
    await this.rbac.requirePermission(actor, "business_partner.activate");
    return this.transition(actor, id, "active", "business_partner.activate");
  }

  async deactivate(actor: ActorContext, id: string): Promise<BusinessPartner> {
    await this.rbac.requirePermission(actor, "business_partner.deactivate");
    return this.transition(actor, id, "inactive", "business_partner.deactivate");
  }

  async tombstone(actor: ActorContext, id: string): Promise<BusinessPartner> {
    await this.rbac.requirePermission(actor, "business_partner.delete");
    return this.transition(actor, id, "tombstone", "business_partner.delete");
  }

  async remove(actor: ActorContext, id: string): Promise<BusinessPartner> {
    await this.rbac.requirePermission(actor, "business_partner.delete");
    return this.transition(actor, id, "deleted", "business_partner.delete");
  }

  private async transition(
    actor: ActorContext,
    id: string,
    targetStatus: BpLifecycleStatus,
    permissionCode: string,
  ): Promise<BusinessPartner> {
    const bp = await this.repo.findById(actor.tenantId, id);
    if (!bp) throw new NotFoundError("BusinessPartner", id);

    const allowed = BP_LIFECYCLE_TRANSITIONS[bp.lifecycleStatus];
    if (!allowed.includes(targetStatus)) {
      throw new ConflictError(
        `Cannot transition Business Partner from '${bp.lifecycleStatus}' to '${targetStatus}'`,
      );
    }

    return this.repo.setLifecycleStatus(
      actor.tenantId,
      id,
      bp.lifecycleStatus,
      targetStatus,
      actor,
      permissionCode,
    );
  }

  async listRoles(actor: ActorContext, businessPartnerId: string) {
    await this.rbac.requirePermission(actor, "bp_role.read");
    await this.assertOwned(actor, businessPartnerId);
    return this.repo.listRoles(actor.tenantId, businessPartnerId);
  }

  async addRole(
    actor: ActorContext,
    businessPartnerId: string,
    input: CreateBpRoleInput,
  ) {
    await this.rbac.requirePermission(actor, "bp_role.create");
    const bp = await this.getOwned(actor, businessPartnerId);
    if (!BP_ROLE_TYPES.includes(input.roleType)) {
      throw new ConflictError(`Invalid role type '${input.roleType}'`);
    }
    if (input.roleType === "employee" && bp.bpType !== "individual") {
      throw new ConflictError("Employee role requires an Individual Business Partner");
    }
    return this.repo.addRole(actor.tenantId, businessPartnerId, input, actor);
  }

  async updateRole(
    actor: ActorContext,
    businessPartnerId: string,
    roleId: string,
    input: UpdateBpRoleInput,
  ) {
    await this.rbac.requirePermission(actor, "bp_role.update");
    await this.assertOwned(actor, businessPartnerId);
    if (input.status && !BP_ROLE_STATUSES.includes(input.status)) {
      throw new ConflictError(`Invalid role status '${input.status}'`);
    }
    return this.repo.updateRole(actor.tenantId, businessPartnerId, roleId, input, actor);
  }

  async removeRole(actor: ActorContext, businessPartnerId: string, roleId: string) {
    await this.rbac.requirePermission(actor, "bp_role.delete");
    await this.assertOwned(actor, businessPartnerId);
    return this.repo.removeRole(actor.tenantId, businessPartnerId, roleId, actor);
  }

  private async assertOwned(actor: ActorContext, businessPartnerId: string): Promise<void> {
    await this.getOwned(actor, businessPartnerId);
  }

  private async getOwned(
    actor: ActorContext,
    businessPartnerId: string,
  ): Promise<BusinessPartner> {
    const bp = await this.repo.findById(actor.tenantId, businessPartnerId);
    if (!bp) throw new NotFoundError("BusinessPartner", businessPartnerId);
    return bp;
  }

  private validateType(value: string): asserts value is "individual" | "organization" {
    if (!BP_TYPES.includes(value as "individual" | "organization")) {
      throw new ConflictError(`Invalid bp_type '${value}'`);
    }
  }
}
