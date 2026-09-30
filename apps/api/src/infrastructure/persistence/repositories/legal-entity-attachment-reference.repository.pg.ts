import type { Pool, PoolClient } from "pg";
import type {
  CreateAttachmentReferenceInput,
  LegalEntityAttachmentReference,
  LegalEntityAttachmentReferenceRepository,
  AttachmentReferenceStatus,
  UpdateAttachmentReferenceInput,
} from "../../../domain/legal-entity-attachment-reference/legal-entity-attachment-reference.entity.js";
import type { ActorContext } from "../../../domain/shared-kernel/audit-context.js";
import { NotFoundError } from "../../../domain/shared-kernel/errors.js";
import {
  inGovernedTransaction,
  requireTransactionActorPermission,
  recordGovernedAudit,
} from "./governed-transaction.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): LegalEntityAttachmentReference {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    legalEntityId: row.legal_entity_id,
    documentCategory: row.document_category,
    attachmentReference: row.attachment_reference,
    expiryDate: row.expiry_date ? new Date(row.expiry_date) : null,
    status: row.status as AttachmentReferenceStatus,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

/**
 * G4 §4.5 step 18 — repository for Legal Entity attachment reference metadata.
 *
 * Follows the same patterns as the address sub-resource in
 * `legal-entity.repository.pg.ts`:
 *
 * 1. **Ownership is a database fact** — the composite FK
 *    `(tenant_id, legal_entity_id) → legal_entities(tenant_id, id)` makes a
 *    cross-tenant row unrepresentable. The repository states the same rule one
 *    layer up (`lockOwnedLegalEntity`) so the failure is a `NotFoundError`
 *    rather than a constraint violation.
 *
 * 2. **Governed transactions** — every write runs inside
 *    `inGovernedTransaction`, which acquires the tenant lock, performs the
 *    mutation, and records the audit row in the same transaction.
 *
 * 3. **No hard delete** — attachment references are superseded by setting
 *    `status = 'superseded'`, so the reference an old document cited keeps
 *    resolving.
 *
 * This is a separate repository rather than additional methods on
 * `PgLegalEntityRepository` because it owns a distinct table
 * (`legal_entity_attachment_references`) and a distinct question ("what
 * documents are attached?") from the Legal Entity aggregate ("what is the
 * entity?"). The two share the same governed-transaction and ownership-check
 * patterns.
 */
export class PgLegalEntityAttachmentReferenceRepository
  implements LegalEntityAttachmentReferenceRepository
{
  constructor(private readonly pool: Pool) {}

  async listByLegalEntity(
    tenantId: string,
    legalEntityId: string,
  ): Promise<LegalEntityAttachmentReference[]> {
    // Resolve the Legal Entity first: a cross-tenant id must be reported as
    // absent, never as an empty list.
    const owner = await this.pool.query(
      `SELECT id FROM legal_entities WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [legalEntityId, tenantId],
    );
    if (!owner.rows[0]) throw new NotFoundError("LegalEntity", legalEntityId);

    const result = await this.pool.query(
      `SELECT * FROM legal_entity_attachment_references
        WHERE tenant_id = $1 AND legal_entity_id = $2
        ORDER BY created_at ASC`,
      [tenantId, legalEntityId],
    );
    return result.rows.map(mapRow);
  }

  async findById(
    tenantId: string,
    legalEntityId: string,
    id: string,
  ): Promise<LegalEntityAttachmentReference | null> {
    const result = await this.pool.query(
      `SELECT * FROM legal_entity_attachment_references
        WHERE tenant_id = $1 AND legal_entity_id = $2 AND id = $3`,
      [tenantId, legalEntityId, id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async create(
    tenantId: string,
    legalEntityId: string,
    input: CreateAttachmentReferenceInput,
    actor: ActorContext,
  ): Promise<LegalEntityAttachmentReference> {
    return inGovernedTransaction(this.pool, tenantId, async (client) => {
      await requireTransactionActorPermission(client, actor, "legal_entity.update");
      await this.lockOwnedLegalEntity(client, legalEntityId, tenantId);

      const created = await client.query(
        `INSERT INTO legal_entity_attachment_references
           (tenant_id, legal_entity_id, document_category, attachment_reference,
            expiry_date, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING *`,
        [
          tenantId,
          legalEntityId,
          input.documentCategory,
          input.attachmentReference,
          input.expiryDate ?? null,
          actor.userId,
        ],
      );

      await recordGovernedAudit(client, {
        tenantId,
        actorUserId: actor.userId,
        action: "legal_entity.attachment_reference.created",
        entityType: "legal_entity_attachment_reference",
        entityId: created.rows[0].id as string,
        metadata: {
          legalEntityId,
          documentCategory: input.documentCategory,
          attachmentReference: input.attachmentReference,
        },
      });

      return mapRow(created.rows[0]);
    });
  }

  async update(
    tenantId: string,
    legalEntityId: string,
    id: string,
    input: UpdateAttachmentReferenceInput,
    actor: ActorContext,
  ): Promise<LegalEntityAttachmentReference> {
    return inGovernedTransaction(this.pool, tenantId, async (client) => {
      await requireTransactionActorPermission(client, actor, "legal_entity.update");
      await this.lockOwnedLegalEntity(client, legalEntityId, tenantId);

      const SET_CLAUSES: string[] = ["updated_by = $1", "updated_at = now()"];
      const params: unknown[] = [actor.userId];
      let paramIdx = 2;

      if (input.status !== undefined) {
        SET_CLAUSES.push(`status = $${paramIdx++}`);
        params.push(input.status);
      }
      if (input.expiryDate !== undefined) {
        SET_CLAUSES.push(`expiry_date = $${paramIdx++}`);
        params.push(input.expiryDate ?? null);
      }

      // Always touch updated_at/updated_by even if no field changes.
      const updated = await client.query(
        `UPDATE legal_entity_attachment_references
            SET ${SET_CLAUSES.join(", ")}
          WHERE id = $${paramIdx++}
            AND legal_entity_id = $${paramIdx++}
            AND tenant_id = $${paramIdx++}
        RETURNING *`,
        [...params, id, legalEntityId, tenantId],
      );

      if (!updated.rows[0]) {
        throw new NotFoundError("LegalEntityAttachmentReference", id);
      }

      await recordGovernedAudit(client, {
        tenantId,
        actorUserId: actor.userId,
        action: "legal_entity.attachment_reference.updated",
        entityType: "legal_entity_attachment_reference",
        entityId: id,
        metadata: {
          legalEntityId,
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.expiryDate !== undefined ? { expiryDate: input.expiryDate } : {}),
        },
      });

      return mapRow(updated.rows[0]);
    });
  }

  /**
   * Resolve and lock the owning Legal Entity within a governed transaction.
   * Follows the same pattern as `PgLegalEntityRepository.lockOwnedLegalEntity`:
   * `FOR UPDATE` prevents concurrent modification, and the tenant_id check
   * ensures same-Tenant ownership.
   */
  private async lockOwnedLegalEntity(
    client: PoolClient,
    legalEntityId: string,
    tenantId: string,
  ): Promise<void> {
    const result = await client.query(
      `SELECT id FROM legal_entities
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [legalEntityId, tenantId],
    );
    if (!result.rows[0]) throw new NotFoundError("LegalEntity", legalEntityId);
  }
}