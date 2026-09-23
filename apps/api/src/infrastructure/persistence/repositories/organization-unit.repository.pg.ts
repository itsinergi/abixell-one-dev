import type { Pool } from "pg";
import type {
  CreateOrganizationUnitInput,
  OrganizationUnit,
  OrganizationUnitRepository,
  UpdateOrganizationUnitInput,
} from "../../../domain/organization-unit/organization-unit.entity.js";
import type { ActorContext } from "../../../domain/shared-kernel/audit-context.js";
import { ConflictError, NotFoundError } from "../../../domain/shared-kernel/errors.js";
import {
  inGovernedTransaction,
  requireTransactionActorPermission,
  recordGovernedAudit,
} from "./governed-transaction.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): OrganizationUnit {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    legalEntityId: row.legal_entity_id,
    parentId: row.parent_id,
    name: row.name,
    unitType: row.unit_type,
    isActive: row.is_active,
    deactivatedAt: row.deactivated_at ? new Date(row.deactivated_at) : null,
    deactivatedBy: row.deactivated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PgOrganizationUnitRepository implements OrganizationUnitRepository {
  constructor(private readonly pool: Pool) {}

  async create(
    input: CreateOrganizationUnitInput,
    createdBy: string | null,
  ): Promise<OrganizationUnit> {
    const result = await this.pool.query(
      `INSERT INTO organization_units
         (tenant_id, legal_entity_id, parent_id, name, unit_type, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       RETURNING *`,
      [
        input.tenantId,
        input.legalEntityId,
        input.parentId ?? null,
        input.name,
        input.unitType ?? "Organization Unit",
        createdBy,
      ],
    );
    return mapRow(result.rows[0]);
  }

  async findById(id: string): Promise<OrganizationUnit | null> {
    const result = await this.pool.query(
      `SELECT * FROM organization_units WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async listByTenant(tenantId: string): Promise<OrganizationUnit[]> {
    const result = await this.pool.query(
      `SELECT * FROM organization_units WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
      [tenantId],
    );
    return result.rows.map(mapRow);
  }

  async listAncestorIds(id: string): Promise<string[]> {
    const result = await this.pool.query(
      `WITH RECURSIVE ancestors AS (
         SELECT id, parent_id, tenant_id
           FROM organization_units
          WHERE id = $1
            AND deleted_at IS NULL
         UNION ALL
         SELECT ou.id, ou.parent_id, ou.tenant_id
           FROM organization_units ou
           JOIN ancestors a
             ON ou.id = a.parent_id
            AND ou.tenant_id = a.tenant_id
          WHERE ou.deleted_at IS NULL
       )
       SELECT id FROM ancestors`,
      [id],
    );
    return result.rows.map((r) => r.id as string);
  }

  async update(
    id: string,
    input: UpdateOrganizationUnitInput,
    actor: ActorContext,
  ): Promise<OrganizationUnit> {
    return inGovernedTransaction(this.pool, actor.tenantId, async (client) => {
      await requireTransactionActorPermission(
        client,
        actor.tenantId,
        actor.userId,
        "organization_unit.update",
        id,
      );

      // Tenant ownership is revalidated inside the transaction, and a unit
      // belonging to another tenant is reported as absent rather than
      // forbidden, so the endpoint never confirms that a cross-tenant id
      // exists. `parent_id`, `legal_entity_id` and `tenant_id` are absent
      // from the UPDATE: they are immutable after creation.
      const updated = await client.query(
        `UPDATE organization_units
            SET name = $1,
                unit_type = $2,
                updated_by = $3,
                updated_at = now()
          WHERE id = $4
            AND tenant_id = $5
            AND deleted_at IS NULL
        RETURNING *`,
        [
          input.name,
          input.unitType ?? "Organization Unit",
          actor.userId,
          id,
          actor.tenantId,
        ],
      );
      if (!updated.rows[0]) throw new NotFoundError("OrganizationUnit", id);

      await recordGovernedAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "organization_unit.updated",
        entityType: "organization_unit",
        entityId: id,
        metadata: {
          name: updated.rows[0].name,
          unitType: updated.rows[0].unit_type,
        },
      });

      return mapRow(updated.rows[0]);
    });
  }

  async setActive(
    id: string,
    isActive: boolean,
    actor: ActorContext,
  ): Promise<OrganizationUnit> {
    return inGovernedTransaction(this.pool, actor.tenantId, async (client) => {
      await requireTransactionActorPermission(
        client,
        actor.tenantId,
        actor.userId,
        isActive ? "organization_unit.activate" : "organization_unit.deactivate",
        id,
      );

      // All lifecycle mutations acquire the tenant lock before touching a
      // target. Lock the target as well for the active-child guard below.
      const target = await client.query(
        `SELECT id, is_active, parent_id, legal_entity_id
           FROM organization_units
          WHERE id = $1
            AND tenant_id = $2
            AND deleted_at IS NULL
          FOR UPDATE`,
        [id, actor.tenantId],
      );
      if (!target.rows[0]) throw new NotFoundError("OrganizationUnit", id);

      if (!isActive) {
        // A unit may not be deactivated while it still has active direct
        // children: deactivation never cascades, so allowing it would
        // strand the children under an inactive parent. Inactive children
        // never block. Rows are locked so a child cannot be activated
        // concurrently after this check passes.
        const activeChildren = await client.query(
          `SELECT 1
             FROM organization_units
            WHERE parent_id = $1
              AND tenant_id = $2
              AND is_active = true
              AND deleted_at IS NULL
            FOR UPDATE`,
          [id, actor.tenantId],
        );
        if (activeChildren.rows.length > 0) {
          throw new ConflictError(
            "Organization Unit still has active child units. Deactivate them first.",
          );
        }
      } else {
        // A unit may not be activated if its parent is inactive, or if its
        // owning legal entity is inactive. Lock both to serialize.
        if (target.rows[0].parent_id) {
          const parent = await client.query(
            `SELECT 1 FROM organization_units
             WHERE id = $1 AND tenant_id = $2 AND is_active = true
               AND deleted_at IS NULL FOR UPDATE`,
            [target.rows[0].parent_id, actor.tenantId],
          );
          if (!parent.rows[0]) {
            throw new ConflictError(
              "Parent Organization Unit is inactive. Activate it first.",
            );
          }
        }
        const le = await client.query(
          `SELECT 1 FROM legal_entities
           WHERE id = $1 AND tenant_id = $2 AND is_active = true
             AND deleted_at IS NULL FOR UPDATE`,
          [target.rows[0].legal_entity_id, actor.tenantId],
        );
        if (!le.rows[0]) {
          throw new ConflictError(
            "Owning Legal Entity is inactive. Activate it first.",
          );
        }
      }

      const updated = await client.query(
        `UPDATE organization_units
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
      if (!updated.rows[0]) throw new NotFoundError("OrganizationUnit", id);

      await recordGovernedAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: isActive ? "organization_unit.activated" : "organization_unit.deactivated",
        entityType: "organization_unit",
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
