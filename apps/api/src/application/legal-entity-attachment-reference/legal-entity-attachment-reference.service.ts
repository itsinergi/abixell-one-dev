import type {
  CreateAttachmentReferenceInput,
  LegalEntityAttachmentReferenceRepository,
  UpdateAttachmentReferenceInput,
} from "../../domain/legal-entity-attachment-reference/legal-entity-attachment-reference.entity.js";
import { NotFoundError } from "../../domain/shared-kernel/errors.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { LegalEntityRepository } from "../../domain/legal-entity/legal-entity.entity.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";

/**
 * Epic 5 G4 §4.5 step 18 — application service for Legal Entity attachment
 * reference metadata.
 *
 * Mirrors the shape of `LegalEntityService`'s address methods: every method
 * resolves the owning Legal Entity in the caller's Tenant (a cross-tenant id
 * is a `NotFoundError`), enforces Data Scope coverage via
 * `requireLegalEntityScopeForActor`, and delegates to the governed repository.
 *
 * No `AuditService` dependency: the repository records its audit row inside the
 * governed transaction, so the trail can never outlive a rolled-back change
 * (same rule the rest of Epic 5 follows).
 *
 * Lifecycle rule: the Legal Entity must be OPEN FOR NEW WORK
 * (`requireActiveLegalEntityScopeForActor`) for `create`, because attaching a
 * new document reference to an inactive Legal Entity is a mutation against a
 * closed entity. `update` uses the lifecycle-safe form so an `expired` or
 * `superseded` reference on an inactive Legal Entity can still be managed (the
 * attachment outlives the entity's active window, exactly like an address).
 */
export class LegalEntityAttachmentReferenceService {
  constructor(
    private readonly repo: LegalEntityAttachmentReferenceRepository,
    private readonly legalEntityRepo: LegalEntityRepository,
    private readonly rbac: RbacService,
  ) {}

  async listForLegalEntity(actor: ActorContext, legalEntityId: string) {
    await this.rbac.requirePermission(actor, "legal_entity.read");
    await this.assertScoped(actor, legalEntityId, false);
    return this.repo.listByLegalEntity(actor.tenantId, legalEntityId);
  }

  async create(actor: ActorContext, legalEntityId: string, input: CreateAttachmentReferenceInput) {
    await this.rbac.requirePermission(actor, "legal_entity.update");
    await this.assertScoped(actor, legalEntityId, true);
    return this.repo.create(actor.tenantId, legalEntityId, input, actor);
  }

  async update(
    actor: ActorContext,
    legalEntityId: string,
    referenceId: string,
    input: UpdateAttachmentReferenceInput,
  ) {
    await this.rbac.requirePermission(actor, "legal_entity.update");
    await this.assertScoped(actor, legalEntityId, false);
    return this.repo.update(actor.tenantId, legalEntityId, referenceId, input, actor);
  }

  /**
   * Same-Tenant ownership plus Data Scope coverage.
   *
   * `requireActive` picks the form:
   * - `create` uses `requireActiveLegalEntityScopeForActor` — the target must
   *   be open for new work (`active` or `draft`), so a new reference cannot be
   *   attached to an inactive/tombstoned Legal Entity.
   * - `list`/`update` use `requireLegalEntityScopeForActor` — the lifecycle-safe
   *   form, so references on an inactive Legal Entity stay readable and
   *   manageable (an `expired` reference is still a reference an old document
   *   cited).
   */
  private async assertScoped(
    actor: ActorContext,
    legalEntityId: string,
    requireActive: boolean,
  ): Promise<void> {
    const legalEntity = await this.legalEntityRepo.findById(legalEntityId);
    if (!legalEntity || legalEntity.tenantId !== actor.tenantId) {
      throw new NotFoundError("LegalEntity", legalEntityId);
    }
    if (requireActive) {
      await this.rbac.requireActiveLegalEntityScopeForActor(actor, legalEntityId);
    } else {
      await this.rbac.requireLegalEntityScopeForActor(actor, legalEntityId);
    }
  }
}