import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import { NotFoundError } from "../../domain/shared-kernel/errors.js";
import type { DocumentRecord, DocumentRepository } from "../../domain/document/document.entity.js";
import type { LocalFileStorage } from "../../infrastructure/storage/local-file-storage.js";
import type { EventBus } from "../event/event-bus.js";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB — Phase 0 fixed cap, not yet Tenant Configuration.

/**
 * Document / File Service (Checkpoint 0E), per
 * 06-Notification-Document-Audit-Foundation.md. Polymorphic attachment:
 * every Document points at (entityType, entityId), the same opaque
 * reference pattern as Workflow Instance and Domain Event.
 *
 * Access control simplification (documented gap, same class as 0C's
 * Terminology tenant-scope-only simplification): doc 06 says file access
 * should "mengikuti data scope entity induknya" (follow the parent
 * entity's Data Scope) — e.g. a complaint photo should only be visible to
 * whoever can see that complaint. Because this checkpoint is explicitly
 * generic/entity-agnostic (no business module exists to resolve "the Data
 * Scope of a Complaint" from), Phase 0 enforces `document.manage`/
 * `.read` at the Tenant level only — any user with the permission can
 * attach/read documents for any entity in their own Tenant. A real
 * business module wiring this up later would add a per-entity-type Data
 * Scope resolver; nothing about `DocumentRepository`'s polymorphic shape
 * needs to change for that.
 */
export class DocumentService {
  constructor(
    private readonly repo: DocumentRepository,
    private readonly storage: LocalFileStorage,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly eventBus: EventBus,
  ) {}

  async upload(
    actor: ActorContext,
    input: { entityType: string; entityId: string; fileName: string; mimeType: string; buffer: Buffer },
  ): Promise<DocumentRecord> {
    await this.rbac.requirePermission(actor.userId, "document.manage");
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
    await this.rbac.requirePermission(actor.userId, "document.read");
    return this.repo.listByEntity(actor.tenantId, entityType, entityId);
  }

  async download(actor: ActorContext, id: string): Promise<{ doc: DocumentRecord; buffer: Buffer }> {
    await this.rbac.requirePermission(actor.userId, "document.read");
    const doc = await this.getOrThrow(actor.tenantId, id);
    const buffer = await this.storage.read(doc.storagePath);
    return { doc, buffer };
  }

  async delete(actor: ActorContext, id: string): Promise<DocumentRecord> {
    await this.rbac.requirePermission(actor.userId, "document.manage");
    await this.getOrThrow(actor.tenantId, id);
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
