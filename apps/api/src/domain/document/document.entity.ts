/**
 * Domain types for the Document / File Service (Checkpoint 0E), per
 * 06-Notification-Document-Audit-Foundation.md: "Layanan tunggal untuk
 * upload, penyimpanan, dan retensi file ... Setiap file terhubung ke satu
 * entity transaksi (polymorphic reference), bukan disimpan terpisah
 * tanpa konteks."
 *
 * `entityType`/`entityId` is the same opaque polymorphic-reference
 * pattern as Workflow Instance (0D) and Domain Event (0E) — this module
 * does not know what a Complaint or a Demo Transaction is, it only knows
 * "this file belongs to (entityType, entityId)".
 */

export interface DocumentRecord {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  checksum: string;
  uploadedBy: string | null;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface DocumentRepository {
  create(input: {
    tenantId: string;
    entityType: string;
    entityId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    storagePath: string;
    checksum: string;
    uploadedBy: string | null;
  }): Promise<DocumentRecord>;

  findById(id: string): Promise<DocumentRecord | null>;
  listByEntity(tenantId: string, entityType: string, entityId: string): Promise<DocumentRecord[]>;
  softDelete(id: string): Promise<DocumentRecord | null>;
}
