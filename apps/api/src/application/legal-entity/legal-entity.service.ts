import type {
  CreateLegalEntityInput,
  LegalEntityRepository,
} from "../../domain/legal-entity/legal-entity.entity.js";
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
    await this.rbac.requirePermission(actor.userId, "legal_entity.create");

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
    await this.rbac.requirePermission(actor.userId, "legal_entity.read");
    return this.repo.listByTenant(actor.tenantId);
  }
}
