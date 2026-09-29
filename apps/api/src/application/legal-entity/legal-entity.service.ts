import type {
  CreateLegalEntityAddressInput,
  CreateLegalEntityInput,
  LegalEntityRepository,
  LifecycleStatus,
  UpdateLegalEntityAddressInput,
  UpdateLegalEntityInput,
} from "../../domain/legal-entity/legal-entity.entity.js";
import { NotFoundError } from "../../domain/shared-kernel/errors.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";

/**
 * Legal Entity application service.
 *
 * There is deliberately no `AuditService` dependency any more: every write this
 * service performs is a governed write, and the governed transaction in
 * `PgLegalEntityRepository` records the audit row inside the same transaction
 * as the change (`recordGovernedAudit`). Auditing from the service would put
 * the trail outside the transaction that made the change — the exact split the
 * Epic 5 lifecycle rules forbid.
 */
export class LegalEntityService {
  constructor(
    private readonly repo: LegalEntityRepository,
    private readonly rbac: RbacService,
  ) {}

  /**
   * Creation is atomic: the repository writes the Legal Entity, its one Central
   * root Organization Unit and both audit rows in a single governed
   * transaction. A failure creating the Central leaves no Legal Entity behind.
   */
  async create(actor: ActorContext, input: Omit<CreateLegalEntityInput, "tenantId">) {
    await this.rbac.requirePermission(actor, "legal_entity.create");

    return this.repo.create({ ...input, tenantId: actor.tenantId }, actor);
  }

  async listForTenant(actor: ActorContext) {
    await this.rbac.requirePermission(actor, "legal_entity.read");
    return this.repo.listByTenant(actor.tenantId);
  }

  async update(actor: ActorContext, id: string, input: UpdateLegalEntityInput) {
    await this.rbac.requirePermission(actor, "legal_entity.update");
    const legalEntity = await this.repo.findById(id);
    if (!legalEntity || legalEntity.tenantId !== actor.tenantId) {
      throw new NotFoundError("LegalEntity", id);
    }
    return this.repo.update(id, input, actor);
  }

  async setActive(actor: ActorContext, id: string, isActive: boolean) {
    await this.rbac.requirePermission(
      actor,
      isActive ? "legal_entity.activate" : "legal_entity.deactivate",
    );
    const legalEntity = await this.repo.findById(id);
    if (!legalEntity || legalEntity.tenantId !== actor.tenantId) {
      throw new NotFoundError("LegalEntity", id);
    }
    return this.repo.setActive(id, isActive, actor);
  }

  /**
   * Explicit lifecycle transition (`POST /legal-entities/:id/status`). The
   * capability required is the direction of travel: entering `active` needs
   * `legal_entity.activate`; every other move needs `legal_entity.deactivate`.
   * The transition policy itself lives in the repository, next to the row lock.
   */
  async updateStatus(actor: ActorContext, id: string, status: LifecycleStatus) {
    await this.rbac.requirePermission(
      actor,
      status === "active" ? "legal_entity.activate" : "legal_entity.deactivate",
    );
    const legalEntity = await this.repo.findById(id);
    if (!legalEntity || legalEntity.tenantId !== actor.tenantId) {
      throw new NotFoundError("LegalEntity", id);
    }
    return this.repo.updateStatus(id, status, actor);
  }

  /**
   * Addresses belong to the Legal Entity aggregate, so every method resolves
   * the owning Legal Entity in the caller's Tenant before delegating — a
   * cross-tenant id is a `NotFoundError`, never a silent empty result or a
   * write into another Tenant. The repository repeats the same check inside the
   * transaction (the composite FK is the database backstop).
   */
  async listAddresses(actor: ActorContext, legalEntityId: string) {
    await this.rbac.requirePermission(actor, "legal_entity.read");
    await this.assertOwned(actor, legalEntityId);
    return this.repo.listAddresses(legalEntityId, actor);
  }

  async createAddress(
    actor: ActorContext,
    legalEntityId: string,
    input: CreateLegalEntityAddressInput,
  ) {
    await this.rbac.requirePermission(actor, "legal_entity.update");
    await this.assertOwned(actor, legalEntityId);
    return this.repo.createAddress(legalEntityId, input, actor);
  }

  async updateAddress(
    actor: ActorContext,
    legalEntityId: string,
    addressId: string,
    input: UpdateLegalEntityAddressInput,
  ) {
    await this.rbac.requirePermission(actor, "legal_entity.update");
    await this.assertOwned(actor, legalEntityId);
    return this.repo.updateAddress(legalEntityId, addressId, input, actor);
  }

  async deactivateAddress(actor: ActorContext, legalEntityId: string, addressId: string) {
    await this.rbac.requirePermission(actor, "legal_entity.update");
    await this.assertOwned(actor, legalEntityId);
    return this.repo.deactivateAddress(legalEntityId, addressId, actor);
  }

  /** Same-Tenant ownership check, stated before any work is done so a
   * cross-tenant Legal Entity id can never even reach the write path. */
  private async assertOwned(actor: ActorContext, legalEntityId: string): Promise<void> {
    const legalEntity = await this.repo.findById(legalEntityId);
    if (!legalEntity || legalEntity.tenantId !== actor.tenantId) {
      throw new NotFoundError("LegalEntity", legalEntityId);
    }
  }
}
