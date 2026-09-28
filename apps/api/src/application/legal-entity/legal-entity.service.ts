import type {
  CreateLegalEntityInput,
  LegalEntityRepository,
  UpdateLegalEntityInput,
} from "../../domain/legal-entity/legal-entity.entity.js";
import { NotFoundError } from "../../domain/shared-kernel/errors.js";
import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";

export class LegalEntityService {
  constructor(
    private readonly repo: LegalEntityRepository,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  async create(actor: ActorContext, input: Omit<CreateLegalEntityInput, "tenantId">) {
    await this.rbac.requirePermission(actor, "legal_entity.create");

    const legalEntity = await this.repo.create(
      { ...input, tenantId: actor.tenantId },
      actor.userId,
    );

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "legal_entity.created",
      entityType: "legal_entity",
      entityId: legalEntity.id,
      metadata: { name: legalEntity.name },
    });

    return legalEntity;
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
}
