import type { Pool } from "pg";
import type {
  CreateLegalEntityInput,
  LegalEntity,
  LegalEntityRepository,
  UpdateLegalEntityInput,
} from "../../../domain/legal-entity/legal-entity.entity.js";
import type { ActorContext } from "../../../domain/shared-kernel/audit-context.js";
import { ConflictError, NotFoundError } from "../../../domain/shared-kernel/errors.js";
import {
  inGovernedTransaction,
  requireTransactionActorPermission,
  recordGovernedAudit,
} from "./governed-transaction.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): LegalEntity {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    registrationNo: row.registration_no,
    isActive: row.is_active,
    deactivatedAt: row.deactivated_at ? new Date(row.deactivated_at) : null,
    deactivatedBy: row.deactivated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PgLegalEntityRepository implements LegalEntityRepository {
  constructor(private readonly pool: Pool) {}

  async create(
    input: CreateLegalEntityInput,
    createdBy: string | null,
  ): Promise<LegalEntity> {
    const result = await this.pool.query(
      `INSERT INTO legal_entities (tenant_id, name, registration_no, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $4)
       RETURNING *`,
      [input.tenantId, input.name, input.registrationNo ?? null, createdBy],
    );
    return mapRow(result.rows[0]);
  }

  async findById(id: string): Promise<LegalEntity | null> {
    const result = await this.pool.query(
      `SELECT * FROM legal_entities WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async listByTenant(tenantId: string): Promise<LegalEntity[]> {
    const result = await this.pool.query(
      `SELECT * FROM legal_entities WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
      [tenantId],
    );
    return result.rows.map(mapRow);
  }

  async update(
    id: string,
    input: UpdateLegalEntityInput,
    actor: ActorContext,
  ): Promise<LegalEntity> {
    return inGovernedTransaction(this.pool, actor.tenantId, async (client) => {
      await requireTransactionActorPermission(
        client,
        actor.tenantId,
        actor.userId,
        "legal_entity.update",
      );

      // `tenant_id` is absent from the UPDATE: immutable after creation.
      const updated = await client.query(
        `UPDATE legal_entities
            SET name = $1,
                registration_no = $2,
                updated_by = $3,
                updated_at = now()
          WHERE id = $4
            AND tenant_id = $5
            AND deleted_at IS NULL
        RETURNING *`,
        [input.name, input.registrationNo ?? null, actor.userId, id, actor.tenantId],
      );
      if (!updated.rows[0]) throw new NotFoundError("LegalEntity", id);

      await recordGovernedAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "legal_entity.updated",
        entityType: "legal_entity",
        entityId: id,
        metadata: {
          name: updated.rows[0].name,
          registrationNo: updated.rows[0].registration_no,
        },
      });

      return mapRow(updated.rows[0]);
    });
  }

  async setActive(
    id: string,
    isActive: boolean,
    actor: ActorContext,
  ): Promise<LegalEntity> {
    return inGovernedTransaction(this.pool, actor.tenantId, async (client) => {
      await requireTransactionActorPermission(
        client,
        actor.tenantId,
        actor.userId,
        isActive ? "legal_entity.activate" : "legal_entity.deactivate",
      );

      const target = await client.query(
        `SELECT id, is_active
           FROM legal_entities
          WHERE id = $1
            AND tenant_id = $2
            AND deleted_at IS NULL
          FOR UPDATE`,
        [id, actor.tenantId],
      );
      if (!target.rows[0]) throw new NotFoundError("LegalEntity", id);

      if (!isActive) {
        // A Legal Entity may not be deactivated while it still owns active
        // Organization Units: deactivation never cascades, so allowing it
        // would strand active units under an inactive entity. Rows are
        // locked so a unit cannot be activated concurrently after this
        // check passes.
        const activeUnits = await client.query(
          `SELECT 1
             FROM organization_units
            WHERE legal_entity_id = $1
              AND tenant_id = $2
              AND is_active = true
              AND deleted_at IS NULL
            FOR UPDATE`,
          [id, actor.tenantId],
        );
        if (activeUnits.rows.length > 0) {
          throw new ConflictError(
            "Legal Entity still has active Organization Units. Deactivate them first.",
          );
        }
      }

      const updated = await client.query(
        `UPDATE legal_entities
            SET is_active = $1,
                deactivated_at = CASE WHEN $1 THEN NULL ELSE now() END,
                deactivated_by = CASE WHEN $1 THEN NULL ELSE $2::uuid END,
                updated_by = $2,
                updated_at = now()
          WHERE id = $3
            AND tenant_id = $4
            AND deleted_at IS NULL
        RETURNING *`,
        [isActive, actor.userId, id, actor.tenantId],
      );
      if (!updated.rows[0]) throw new NotFoundError("LegalEntity", id);

      await recordGovernedAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: isActive ? "legal_entity.activated" : "legal_entity.deactivated",
        entityType: "legal_entity",
        entityId: id,
        metadata: {
          previousIsActive: target.rows[0].is_active,
          isActive,
        },
      });

      return mapRow(updated.rows[0]);
    });
  }
}
