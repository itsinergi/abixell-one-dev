import type { Pool, QueryResultRow } from "pg";
import type { DocumentRecord, DocumentRepository } from "../../../domain/document/document.entity.js";

export class PgDocumentRepository implements DocumentRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: {
    tenantId: string;
    entityType: string;
    entityId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    storagePath: string;
    checksum: string;
    uploadedBy: string | null;
  }): Promise<DocumentRecord> {
    const result = await this.pool.query(
      `INSERT INTO documents
         (tenant_id, entity_type, entity_id, file_name, mime_type, size_bytes, storage_path, checksum, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.tenantId,
        input.entityType,
        input.entityId,
        input.fileName,
        input.mimeType,
        input.sizeBytes,
        input.storagePath,
        input.checksum,
        input.uploadedBy,
      ],
    );
    return mapDocument(result.rows[0]);
  }

  async findById(id: string): Promise<DocumentRecord | null> {
    const result = await this.pool.query(`SELECT * FROM documents WHERE id = $1`, [id]);
    return result.rows[0] ? mapDocument(result.rows[0]) : null;
  }

  async listByEntity(tenantId: string, entityType: string, entityId: string): Promise<DocumentRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM documents
       WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [tenantId, entityType, entityId],
    );
    return result.rows.map(mapDocument);
  }

  async softDelete(id: string): Promise<DocumentRecord | null> {
    const result = await this.pool.query(
      `UPDATE documents SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [id],
    );
    return result.rows[0] ? mapDocument(result.rows[0]) : null;
  }
}

function mapDocument(row: QueryResultRow): DocumentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    storagePath: row.storage_path,
    checksum: row.checksum,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}
