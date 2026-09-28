import type { Pool } from "pg";
import type {
  CreateTenantInput,
  Tenant,
  TenantRepository,
  UpdateTenantInput,
} from "../../../domain/tenant/tenant.entity.js";
import type { ActorContext } from "../../../domain/shared-kernel/audit-context.js";
import { NotFoundError } from "../../../domain/shared-kernel/errors.js";
import {
  inGovernedTransaction,
  recordGovernedAudit,
  requireTransactionActorPermission,
} from "./governed-transaction.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): Tenant {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PgTenantRepository implements TenantRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateTenantInput, createdBy: string | null): Promise<Tenant> {
    const result = await this.pool.query(
      `INSERT INTO tenants (code, name, created_by, updated_by)
       VALUES ($1, $2, $3, $3)
       RETURNING *`,
      [input.code, input.name, createdBy],
    );
    return mapRow(result.rows[0]);
  }

  async findById(id: string): Promise<Tenant | null> {
    const result = await this.pool.query(
      `SELECT * FROM tenants WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async findByCode(code: string): Promise<Tenant | null> {
    const result = await this.pool.query(
      `SELECT * FROM tenants WHERE code = $1 AND deleted_at IS NULL`,
      [code],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async updateName(input: UpdateTenantInput, actor: ActorContext): Promise<{ name: string }> {
    return inGovernedTransaction(this.pool, actor.tenantId, async (client) => {
      await requireTransactionActorPermission(
        client,
        actor,
        "tenant.update",
      );

      const current = await client.query<{ name: string }>(
        `SELECT name FROM tenants WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [actor.tenantId],
      );
      if (!current.rows[0]) throw new NotFoundError("Tenant", actor.tenantId);

      const updated = await client.query<{ name: string }>(
        `UPDATE tenants
            SET name = $1,
                updated_by = $2,
                updated_at = now()
          WHERE id = $3
            AND deleted_at IS NULL
        RETURNING name`,
        [input.name, actor.userId, actor.tenantId],
      );
      if (!updated.rows[0]) throw new NotFoundError("Tenant", actor.tenantId);

      await recordGovernedAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "tenant.updated",
        entityType: "tenant",
        entityId: actor.tenantId,
        metadata: {
          previousName: current.rows[0].name,
          name: updated.rows[0].name,
        },
      });

      return { name: updated.rows[0].name };
    });
  }

  async list(): Promise<Tenant[]> {
    const result = await this.pool.query(
      `SELECT * FROM tenants WHERE deleted_at IS NULL ORDER BY created_at ASC`,
    );
    return result.rows.map(mapRow);
  }
}
