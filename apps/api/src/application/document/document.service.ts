import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import { ForbiddenError, NotFoundError } from "../../domain/shared-kernel/errors.js";
import type { DocumentRecord, DocumentRepository } from "../../domain/document/document.entity.js";
import type { LocalFileStorage } from "../../infrastructure/storage/local-file-storage.js";
import type { EventBus } from "../event/event-bus.js";
import type { EntityAuthorizationResolverRegistry } from "./entity-authorization-resolver.js";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB — Phase 0 fixed cap, not yet Tenant Configuration.

/**
 * Document / File Service (Checkpoint 0E), per
 * 06-Notification-Document-Audit-Foundation.md. Polymorphic attachment:
 * every Document points at (entityType, entityId), the same opaque
 * reference pattern as Workflow Instance and Domain Event.
 *
 * Access control (Checkpoint 1A / ADR-0012, supersedes the Checkpoint 0E
 * Tenant-wide simplification): doc 06 says file access should "mengikuti
 * data scope entity induknya" (follow the parent entity's Data Scope).
 * When a business module has registered an `EntityAuthorizationResolver`
 * for a Document's `entityType` (see entity-authorization-resolver.ts),
 * that resolver's Data-Scope-only check is the SOLE authorization gate —
 * `document.read`/`.manage` is not additionally required, per the
 * Checkpoint 1A binding decision ("attachment tidak memiliki independent
 * business authorization yang terpisah dari parent business entity").
 * When no resolver is registered for the entityType (still true for
 * `demo_transaction`, the only entityType Phase 0's regression suite
 * uses), the Checkpoint 0E behavior is preserved exactly: Tenant-wide
 * `document.read`/`.manage` permission, no per-entity Data Scope.
 */
export class DocumentService {
  constructor(
    private readonly repo: DocumentRepository,
    private readonly storage: LocalFileStorage,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly eventBus: EventBus,
    private readonly resolvers: EntityAuthorizationResolverRegistry = new Map(),
  ) {}

  private async authorizeEntity(
    actor: ActorContext,
    entityType: string,
    entityId: string,
    legacyPermission: "document.read" | "document.manage",
  ): Promise<void> {
    const resolver = this.resolvers.get(entityType);
    if (!resolver) {
      await this.rbac.requirePermission(actor.userId, legacyPermission);
      return;
    }
    const allowed = await resolver.canAccess(actor, entityId);
    if (!allowed) {
      throw new ForbiddenError(
        `Your Data Scope does not cover the '${entityType}' this document belongs to`,
      );
    }
  }

  async upload(
    actor: ActorContext,
    input: { entityType: string; entityId: string; fileName: string; mimeType: string; buffer: Buffer },
  ): Promise<DocumentRecord> {
    await this.authorizeEntity(actor, input.entityType, input.entityId, "document.manage");
    if (input.buffer.length > MAX_UPLOAD_BYTES) {
      throw new Error(`File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB Phase 0 upload cap`);
    }

    const { storagePath, checksum } = await this.storage.save(actor.tenantId, input.fileName, input.buffer);
    const doc = await this.repo.create({
      tenantId: actor.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.length,
      storagePath,
      checksum,
      uploadedBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "document.uploaded",
      entityType: "document",
      entityId: doc.id,
      metadata: { entityType: input.entityType, entityId: input.entityId, fileName: input.fileName, sizeBytes: doc.sizeBytes },
    });

    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: "document.uploaded",
      entityType: input.entityType,
      entityId: input.entityId,
      payload: { documentId: doc.id, fileName: input.fileName, uploadedBy: actor.userId },
      createdBy: actor.userId,
    });

    return doc;
  }

  async listByEntity(actor: ActorContext, entityType: string, entityId: string): Promise<DocumentRecord[]> {
    await this.authorizeEntity(actor, entityType, entityId, "document.read");
    return this.repo.listByEntity(actor.tenantId, entityType, entityId);
  }

  async download(actor: ActorContext, id: string): Promise<{ doc: DocumentRecord; buffer: Buffer }> {
    const doc = await this.getOrThrow(actor.tenantId, id);
    await this.authorizeEntity(actor, doc.entityType, doc.entityId, "document.read");
    const buffer = await this.storage.read(doc.storagePath);
    return { doc, buffer };
  }

  async delete(actor: ActorContext, id: string): Promise<DocumentRecord> {
    const existing = await this.getOrThrow(actor.tenantId, id);
    await this.authorizeEntity(actor, existing.entityType, existing.entityId, "document.manage");
    const deleted = await this.repo.softDelete(id);
    if (!deleted) throw new NotFoundError("Document", id);
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "document.deleted",
      entityType: "document",
      entityId: id,
      metadata: {},
    });
    return deleted;
  }

  private async getOrThrow(tenantId: string, id: string): Promise<DocumentRecord> {
    const doc = await this.repo.findById(id);
    if (!doc || doc.tenantId !== tenantId || doc.deletedAt) throw new NotFoundError("Document", id);
    return doc;
  }
}
