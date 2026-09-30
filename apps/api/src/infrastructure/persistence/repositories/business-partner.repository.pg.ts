import type { Pool, PoolClient } from "pg";
import type {
  BusinessPartner,
  BusinessPartnerRepository,
  BpLifecycleStatus,
  BpRole,
  CreateBusinessPartnerInput,
  CreateBpRoleInput,
  ListBpOptions,
  UpdateBusinessPartnerInput,
  UpdateBpRoleInput,
} from "../../../domain/business-partner/business-partner.entity.js";
import type { ActorContext } from "../../../domain/shared-kernel/audit-context.js";
import { ConflictError, NotFoundError } from "../../../domain/shared-kernel/errors.js";
import {
  inGovernedTransaction,
  requireTransactionActorPermission,
  recordGovernedAudit,
} from "./governed-transaction.js";

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === UNIQUE_VIOLATION
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBpRow(row: any): BusinessPartner {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    bpType: row.bp_type,
    name: row.name,
    bpGroupId: row.bp_group_id,
    lifecycleStatus: row.lifecycle_status,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRoleRow(row: any): BpRole {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    businessPartnerId: row.business_partner_id,
    roleType: row.role_type,
    status: row.status,
    roleNumber: row.role_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Business Partner persistence (Epic 6 Gelombang 1).
 *
 * Follows the same patterns as `department.repository.pg.ts`:
 * - Ownership is a database fact: composite FK `(tenant_id, id) → tenants(id)`
 *   makes cross-tenant rows unrepresentable.
 * - Governed transactions: every write inside `inGovernedTransaction`.
 * - No hard delete: use `deleted_at` timestamp instead.
 *
 * The lifecycle status is gated by the service layer (which checks
 * `BP_LIFECYCLE_TRANSITIONS`); the repository just updates the column.
 *
 * BP roles are a separate table that shares the same transaction pattern:
 * every role write locks the BP and the tenant, records audit.
 */
export class PgBusinessPartnerRepository implements BusinessPartnerRepository {
  constructor(private readonly pool: Pool) {}

  async findById(tenantId: string, id: string): Promise<BusinessPartner | null> {
    const result = await this.pool.query(
      `SELECT * FROM business_partners WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return result.rows[0] ? mapBpRow(result.rows[0]) : null;
  }

  async findByCode(tenantId: string, code: string): Promise<BusinessPartner | null> {
    const result = await this.pool.query(
      `SELECT * FROM business_partners WHERE code = $1 AND tenant_id = $2`,
      [code, tenantId],
    );
    return result.rows[0] ? mapBpRow(result.rows[0]) : null;
  }

  async listByTenant(tenantId: string, options?: ListBpOptions): Promise<BusinessPartner[]> {
    let query = `SELECT * FROM business_partners WHERE tenant_id = $1`;
    const params: unknown[] = [tenantId];
    let paramIdx = 2;

    if (options?.lifecycleStatus) {
      query += ` AND lifecycle_status = $${paramIdx++}`;
      params.push(options.lifecycleStatus);
    }
    if (options?.bpType) {
      query += ` AND bp_type = $${paramIdx++}`;
      params.push(options.bpType);
    }
    if (options?.search) {
      query += ` AND (name ILIKE $${paramIdx++} OR code ILIKE $${paramIdx++})`;
      const searchTerm = `%${options.search}%`;
      params.push(searchTerm, searchTerm);
    }

    query += ` ORDER BY created_at DESC`;

    if (options?.limit) {
      query += ` LIMIT $${paramIdx++}`;
      params.push(options.limit);
    }
    if (options?.offset) {
      query += ` OFFSET $${paramIdx++}`;
      params.push(options.offset);
    }

    const result = await this.pool.query(query, params);
    return result.rows.map(mapBpRow);
  }

  async create(
    tenantId: string,
    input: CreateBusinessPartnerInput,
    actor: ActorContext,
  ): Promise<BusinessPartner> {
    return inGovernedTransaction(this.pool, tenantId, async (client) => {
      await requireTransactionActorPermission(client, actor, "business_partner.create");

      let created;
      try {
        created = await client.query(
          `INSERT INTO business_partners
             (tenant_id, code, bp_type, name, bp_group_id, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $6)
           RETURNING *`,
          [tenantId, input.code, input.bpType, input.name, input.bpGroupId ?? null, actor.userId],
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictError(
            `Business Partner code '${input.code}' already exists in this Tenant`,
          );
        }
        throw error;
      }

      await recordGovernedAudit(client, {
        tenantId,
        actorUserId: actor.userId,
        action: "business_partner.created",
        entityType: "business_partner",
        entityId: created.rows[0].id as string,
        metadata: {
          code: created.rows[0].code,
          bpType: created.rows[0].bp_type,
          name: created.rows[0].name,
        },
      });

      return mapBpRow(created.rows[0]);
    });
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateBusinessPartnerInput,
    actor: ActorContext,
  ): Promise<BusinessPartner> {
    return inGovernedTransaction(this.pool, tenantId, async (client) => {
      await requireTransactionActorPermission(client, actor, "business_partner.update");

      const target = await client.query(
        `SELECT id FROM business_partners WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, tenantId],
      );
      if (!target.rows[0]) throw new NotFoundError("BusinessPartner", id);

      const updated = await client.query(
        `UPDATE business_partners
            SET name = COALESCE($1, name),
                bp_group_id = CASE WHEN $2::boolean THEN $3 ELSE bp_group_id END,
                updated_by = $4,
                updated_at = now()
          WHERE id = $5 AND tenant_id = $6
        RETURNING *`,
        [
          input.name ?? null,
          input.bpGroupId !== undefined,
          input.bpGroupId ?? null,
          actor.userId,
          id,
          tenantId,
        ],
      );
      if (!updated.rows[0]) throw new NotFoundError("BusinessPartner", id);

      await recordGovernedAudit(client, {
        tenantId,
        actorUserId: actor.userId,
        action: "business_partner.updated",
        entityType: "business_partner",
        entityId: id,
        metadata: {
          name: updated.rows[0].name,
          bpGroupId: updated.rows[0].bp_group_id,
        },
      });

      return mapBpRow(updated.rows[0]);
    });
  }

  async setLifecycleStatus(
    tenantId: string,
    id: string,
    currentStatus: BpLifecycleStatus,
    targetStatus: BpLifecycleStatus,
    actor: ActorContext,
    permissionCode = targetStatus === "deleted" || targetStatus === "tombstone"
      ? "business_partner.delete"
      : targetStatus === "active"
        ? "business_partner.activate"
        : "business_partner.deactivate",
  ): Promise<BusinessPartner> {
    return inGovernedTransaction(this.pool, tenantId, async (client) => {
      await requireTransactionActorPermission(client, actor, permissionCode);

      let deletedAt = null;
      let deletedBy = null;
      if (targetStatus === "deleted") {
        deletedAt = new Date();
        deletedBy = actor.userId;
      }

      const updated = await client.query(
        `UPDATE business_partners
            SET lifecycle_status = $1,
                is_active = CASE WHEN $1 = 'active' THEN true ELSE false END,
                deleted_at = COALESCE($2, deleted_at),
                deleted_by = COALESCE($3, deleted_by),
                updated_by = $4,
                updated_at = now()
          WHERE id = $5
            AND tenant_id = $6
            AND lifecycle_status = $7
        RETURNING *`,
        [targetStatus, deletedAt, deletedBy, actor.userId, id, tenantId, currentStatus],
      );
      if (!updated.rows[0]) throw new ConflictError("Business Partner lifecycle changed; retry the transition");

      const action = targetStatus === "active"
        ? "business_partner.activated"
        : targetStatus === "inactive"
          ? "business_partner.deactivated"
          : targetStatus === "tombstone"
            ? "business_partner.tombstoned"
            : "business_partner.deleted";

      await recordGovernedAudit(client, {
        tenantId,
        actorUserId: actor.userId,
        action,
        entityType: "business_partner",
        entityId: id,
        metadata: { status: targetStatus, previousStatus: currentStatus },
      });

      return mapBpRow(updated.rows[0]);
    });
  }

  async findRoleById(
    tenantId: string,
    businessPartnerId: string,
    roleId: string,
  ): Promise<BpRole | null> {
    const result = await this.pool.query(
      `SELECT * FROM bp_roles
        WHERE id = $1 AND business_partner_id = $2
        AND tenant_id = $3`,
      [roleId, businessPartnerId, tenantId],
    );
    return result.rows[0] ? mapRoleRow(result.rows[0]) : null;
  }

  async listRoles(tenantId: string, businessPartnerId: string): Promise<BpRole[]> {
    const result = await this.pool.query(
      `SELECT * FROM bp_roles
        WHERE business_partner_id = $1 AND tenant_id = $2
        ORDER BY created_at ASC`,
      [businessPartnerId, tenantId],
    );
    return result.rows.map(mapRoleRow);
  }

  async addRole(
    tenantId: string,
    businessPartnerId: string,
    input: CreateBpRoleInput,
    actor: ActorContext,
  ): Promise<BpRole> {
    return inGovernedTransaction(this.pool, tenantId, async (client) => {
      await requireTransactionActorPermission(client, actor, "bp_role.create");
      await this.lockOwnedBp(client, businessPartnerId, tenantId);

      let created;
      try {
        created = await client.query(
          `INSERT INTO bp_roles
             (tenant_id, business_partner_id, role_type, role_number)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [tenantId, businessPartnerId, input.roleType, input.roleNumber ?? null],
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictError(
            `Business Partner already has role '${input.roleType}'`,
          );
        }
        throw error;
      }

      await recordGovernedAudit(client, {
        tenantId,
        actorUserId: actor.userId,
        action: "bp_role.created",
        entityType: "bp_role",
        entityId: created.rows[0].id as string,
        metadata: {
          businessPartnerId,
          roleType: input.roleType,
        },
      });

      return mapRoleRow(created.rows[0]);
    });
  }

  async updateRole(
    tenantId: string,
    businessPartnerId: string,
    roleId: string,
    input: UpdateBpRoleInput,
    actor: ActorContext,
  ): Promise<BpRole> {
    return inGovernedTransaction(this.pool, tenantId, async (client) => {
      await requireTransactionActorPermission(client, actor, "bp_role.update");
      await this.lockOwnedBp(client, businessPartnerId, tenantId);

      const updated = await client.query(
        `UPDATE bp_roles
            SET status = COALESCE($1, status),
                role_number = CASE WHEN $2::boolean THEN $3 ELSE role_number END,
                updated_at = now()
          WHERE id = $4
            AND business_partner_id = $5
            AND tenant_id = $6
        RETURNING *`,
        [
          input.status ?? null,
          input.roleNumber !== undefined,
          input.roleNumber ?? null,
          roleId,
          businessPartnerId,
          tenantId,
        ],
      );
      if (!updated.rows[0]) throw new NotFoundError("BpRole", roleId);

      await recordGovernedAudit(client, {
        tenantId,
        actorUserId: actor.userId,
        action: "bp_role.updated",
        entityType: "bp_role",
        entityId: roleId,
        metadata: {
          businessPartnerId,
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });

      return mapRoleRow(updated.rows[0]);
    });
  }

  async removeRole(
    tenantId: string,
    businessPartnerId: string,
    roleId: string,
    actor: ActorContext,
  ): Promise<void> {
    return inGovernedTransaction(this.pool, tenantId, async (client) => {
      await requireTransactionActorPermission(client, actor, "bp_role.delete");
      await this.lockOwnedBp(client, businessPartnerId, tenantId);

      const deleted = await client.query(
        `DELETE FROM bp_roles
          WHERE id = $1
            AND business_partner_id = $2
            AND tenant_id = $3
        RETURNING id`,
        [roleId, businessPartnerId, tenantId],
      );
      if (!deleted.rows[0]) throw new NotFoundError("BpRole", roleId);

      await recordGovernedAudit(client, {
        tenantId,
        actorUserId: actor.userId,
        action: "bp_role.deleted",
        entityType: "bp_role",
        entityId: roleId,
        metadata: { businessPartnerId },
      });
    });
  }

  private async lockOwnedBp(
    client: PoolClient,
    businessPartnerId: string,
    tenantId: string,
  ): Promise<void> {
    const result = await client.query(
      `SELECT id FROM business_partners WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [businessPartnerId, tenantId],
    );
    if (!result.rows[0]) throw new NotFoundError("BusinessPartner", businessPartnerId);
  }
}
