import type { Pool, PoolClient } from "pg";
import type {
  CreateOrganizationUnitInput,
  OrganizationUnit,
  OrganizationUnitRepository,
  OrganizationUnitType,
  UpdateOrganizationUnitInput,
} from "../../../domain/organization-unit/organization-unit.entity.js";
import { isOrganizationUnitType } from "../../../domain/organization-unit/organization-unit.entity.js";
import type { LifecycleStatus } from "../../../domain/legal-entity/legal-entity.entity.js";
import type { ActorContext } from "../../../domain/shared-kernel/audit-context.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../../domain/shared-kernel/errors.js";
import {
  inGovernedTransaction,
  requireTransactionActorPermission,
  recordGovernedAudit,
} from "./governed-transaction.js";

/** PostgreSQL unique-violation — the root-Central partial index raises this. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === UNIQUE_VIOLATION
  );
}

/** What a writer may state for `unit_type`. Anything else the tenant says is
 * wording, and wording belongs in `unit_type_label`. */
function resolveUnitType(requested: string | undefined): {
  unitType: OrganizationUnitType;
  unitTypeLabel: string | null;
} {
  const trimmed = requested?.trim();
  if (trimmed && isOrganizationUnitType(trimmed)) {
    return { unitType: trimmed, unitTypeLabel: null };
  }
  if (trimmed && trimmed.length > 0) {
    return { unitType: "Internal Site", unitTypeLabel: trimmed };
  }
  return { unitType: "Internal Site", unitTypeLabel: null };
}

/** G0 §5 — the same four legal moves the Legal Entity has. A no-op is not a
 * transition. */
function isAllowedTransition(from: LifecycleStatus, to: LifecycleStatus): boolean {
  if (from === to) return true;
  if (from === "draft" && to === "active") return true;
  if (from === "active" && to === "inactive") return true;
  if (from === "inactive" && to === "active") return true;
  if (from === "inactive" && to === "tombstone") return true;
  return false;
}

/** Inactive-mutation guard (roadmap §4.5 step 7). Reads keep resolving
 * history; content writes against a retired unit do not happen. */
function assertMutable(status: LifecycleStatus, what: string): void {
  if (status === "inactive" || status === "tombstone" || status === "deleted") {
    throw new ConflictError(
      `${what} is ${status}; no further changes are allowed. Reactivate it first.`,
    );
  }
}

/** The root Central is the structure anchor of a Legal Entity: it is created
 * with the Legal Entity, it is unique per Legal Entity, and it never moves,
 * changes type, is deactivated or is deleted (§4.5 Putaran 4). The database
 * trigger says the same thing; this is the friendly refusal in front of it. */
function isRootCentral(unitType: string, parentId: string | null): boolean {
  return unitType === "Central" && parentId === null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): OrganizationUnit {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    legalEntityId: row.legal_entity_id,
    parentId: row.parent_id,
    name: row.name,
    unitType: row.unit_type,
    unitTypeLabel: row.unit_type_label ?? null,
    status: row.status as LifecycleStatus,
    replacementOrganizationUnitId: row.replacement_organization_unit_id ?? null,
    timezone: row.timezone ?? null,
    isActive: row.is_active,
    deactivatedAt: row.deactivated_at ? new Date(row.deactivated_at) : null,
    deactivatedBy: row.deactivated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PgOrganizationUnitRepository implements OrganizationUnitRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Creation inside a governed transaction, for the same reason the Legal
   * Entity has one: the owning Legal Entity must be resolved in the actor's
   * Tenant before the row exists, and the permission must be re-checked with
   * the scope the parent implies.
   *
   * `legal_entity_id` is verified here, not merely trusted from the body — a
   * Legal Entity from another Tenant would otherwise be usable as the owner of
   * a unit in this one. The database trigger is the backstop for the parent
   * link; this is the application-level statement of the same rule.
   */
  async create(input: CreateOrganizationUnitInput, actor: ActorContext): Promise<OrganizationUnit> {
    return inGovernedTransaction(this.pool, input.tenantId, async (client) => {
      // A root unit needs tenant-wide scope; a child needs scope covering its
      // parent. Passing the parent id is what lets the same-assignment check
      // see the ancestor, exactly as the service precheck does.
      await requireTransactionActorPermission(
        client,
        actor,
        "organization_unit.create",
        input.parentId ?? undefined,
      );

      const legalEntity = await client.query(
        `SELECT id FROM legal_entities
          WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [input.legalEntityId, actor.tenantId],
      );
      if (!legalEntity.rows[0]) throw new NotFoundError("LegalEntity", input.legalEntityId);

      if (input.parentId) {
        const parent = await client.query(
          `SELECT id, tenant_id, legal_entity_id FROM organization_units
            WHERE id = $1 AND deleted_at IS NULL`,
          [input.parentId],
        );
        if (!parent.rows[0]) throw new NotFoundError("OrganizationUnit", input.parentId);
        if (parent.rows[0].tenant_id !== actor.tenantId) {
          throw new ForbiddenError("Parent Organization Unit belongs to a different Tenant");
        }
        if (parent.rows[0].legal_entity_id !== input.legalEntityId) {
          throw new ForbiddenError(
            "Parent Organization Unit belongs to a different Legal Entity",
          );
        }
      }

      const { unitType, unitTypeLabel } = resolveUnitType(input.unitType);
      const status: LifecycleStatus = "active";

      let created;
      try {
        created = await client.query(
          `INSERT INTO organization_units
             (tenant_id, legal_entity_id, parent_id, name, unit_type, unit_type_label,
              status, is_active, timezone, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $9)
           RETURNING *`,
          [
            input.tenantId,
            input.legalEntityId,
            input.parentId ?? null,
            input.name,
            unitType,
            unitTypeLabel,
            status,
            input.timezone ?? null,
            actor.userId,
          ],
        );
      } catch (error) {
        // `organization_units_one_central_per_legal_entity`: at most one live
        // 'Central' row per Legal Entity, created with the Legal Entity itself.
        if (isUniqueViolation(error)) {
          throw new ConflictError(
            "This Legal Entity already has a root Central Organization Unit",
          );
        }
        throw error;
      }

      await recordGovernedAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "organization_unit.created",
        entityType: "organization_unit",
        entityId: created.rows[0].id as string,
        metadata: {
          name: created.rows[0].name,
          parentId: created.rows[0].parent_id,
          unitType: created.rows[0].unit_type,
        },
      });

      return mapRow(created.rows[0]);
    });
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

  /**
   * Content update: `name`, the tenant's wording (`unit_type_label`) and the
   * optional `timezone` override. A root Central may be renamed and re-labelled,
   * but never moved or re-typed — re-parenting is not expressible (see the
   * comment below) and re-typing is refused.
   */
  async update(
    id: string,
    input: UpdateOrganizationUnitInput,
    actor: ActorContext,
  ): Promise<OrganizationUnit> {
    return inGovernedTransaction(this.pool, actor.tenantId, async (client) => {
      await requireTransactionActorPermission(
        client,
        actor,
        "organization_unit.update",
        id,
      );

      // Tenant ownership is revalidated inside the transaction, and a unit
      // belonging to another tenant is reported as absent rather than
      // forbidden, so the endpoint never confirms that a cross-tenant id
      // exists. `parent_id`, `legal_entity_id` and `tenant_id` are absent
      // from the UPDATE: they are immutable after creation.
      const target = await client.query(
        `SELECT id, status, unit_type, parent_id, unit_type_label FROM organization_units
          WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
          FOR UPDATE`,
        [id, actor.tenantId],
      );
      if (!target.rows[0]) throw new NotFoundError("OrganizationUnit", id);

      const status = target.rows[0].status as LifecycleStatus;
      assertMutable(status, "Organization Unit");

      const rootCentral = isRootCentral(target.rows[0].unit_type, target.rows[0].parent_id);
      const requested = input.unitType?.trim();
      let unitType: string = target.rows[0].unit_type;
      let unitTypeLabel: string | null = target.rows[0].unit_type_label ?? null;

      if (requested !== undefined && requested.length > 0) {
        if (isOrganizationUnitType(requested)) {
          if (rootCentral && requested !== "Central") {
            throw new ConflictError("Root Central Organization Unit cannot be re-typed");
          }
          unitType = requested;
          unitTypeLabel = null;
        } else {
          // Tenants rename through terminology: the wording is stored on the
          // label and `unit_type` — the column security reads — is untouched.
          unitTypeLabel = requested;
        }
      }

      const updated = await client.query(
        `UPDATE organization_units
            SET name = $1,
                unit_type = $2,
                unit_type_label = $3,
                timezone = CASE WHEN $4::boolean THEN $5 ELSE timezone END,
                updated_by = $6,
                updated_at = now()
          WHERE id = $7
            AND tenant_id = $8
            AND deleted_at IS NULL
        RETURNING *`,
        [
          input.name,
          unitType,
          unitTypeLabel,
          input.timezone !== undefined,
          input.timezone ?? null,
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
          unitTypeLabel: updated.rows[0].unit_type_label,
        },
      });

      return mapRow(updated.rows[0]);
    });
  }

  /** The boolean face of `updateStatus`, kept for the existing activate /
   * deactivate routes. */
  async setActive(
    id: string,
    isActive: boolean,
    actor: ActorContext,
  ): Promise<OrganizationUnit> {
    return this.updateStatus(id, isActive ? "active" : "inactive", actor);
  }

  async updateStatus(
    id: string,
    status: LifecycleStatus,
    actor: ActorContext,
  ): Promise<OrganizationUnit> {
    return inGovernedTransaction(this.pool, actor.tenantId, async (client) => {
      await requireTransactionActorPermission(
        client,
        actor,
        status === "active"
          ? "organization_unit.activate"
          : "organization_unit.deactivate",
        id,
      );

      // All lifecycle mutations acquire the tenant lock before touching a
      // target. Lock the target as well for the active-child guard below.
      const target = await client.query(
        `SELECT id, is_active, status, parent_id, legal_entity_id, unit_type
           FROM organization_units
          WHERE id = $1
            AND tenant_id = $2
            AND deleted_at IS NULL
          FOR UPDATE`,
        [id, actor.tenantId],
      );
      if (!target.rows[0]) throw new NotFoundError("OrganizationUnit", id);
      const current = target.rows[0].status as LifecycleStatus;

      // The root Central never changes lifecycle state: deactivating it would
      // leave the Legal Entity without a structure anchor. `unit_type` on the
      // root is protected by the database trigger as well.
      if (isRootCentral(target.rows[0].unit_type, target.rows[0].parent_id)) {
        throw new ConflictError("Root Central Organization Unit cannot be deactivated");
      }

      if (current === "tombstone" || current === "deleted") {
        throw new ConflictError(
          `Organization Unit is ${current} and cannot be moved to '${status}'`,
        );
      }

      // Activation guards run BEFORE the idempotent early return below. A unit
      // that is already active but whose parent or Legal Entity has since gone
      // inactive must not come back as a successful activation: the pre-Epic-5
      // code checked on every activation call, and `tahap-b-lifecycle` encodes
      // exactly that ("blocks activation when parent is inactive" builds an
      // inactive parent with an already-active child).
      if (status === "active") {
        await this.assertActivationContext(client, actor.tenantId, target.rows[0]);
      }

      if (current === status) {
        if (current === "inactive") {
          throw new ConflictError("Organization Unit is already inactive");
        }
        return mapRow(await this.selectRow(client, id, actor.tenantId));
      }
      if (!isAllowedTransition(current, status)) {
        throw new ConflictError(
          `Organization Unit transition '${current}' → '${status}' is not allowed`,
        );
      }

      if (status === "inactive" || status === "tombstone") {
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
        // `status === 'active'` was already asserted above, before the
        // idempotent early return — that is the only remaining reachable case
        // here, so this branch deliberately does nothing rather than repeat
        // the same two queries.
      }

      // `status` is authoritative and `is_active` is derived from it, so the
      // `organization_units_status_is_active_check` constraint always holds.
      const updated = await client.query(
        `UPDATE organization_units
            SET status = $1,
                is_active = ($1::text = 'active'),
                deactivated_at = CASE
                                   WHEN $1 = 'active' THEN NULL
                                   ELSE COALESCE(deactivated_at, now())
                                 END,
                deactivated_by = CASE
                                   WHEN $1 = 'active' THEN NULL
                                   ELSE COALESCE(deactivated_by, $2::uuid)
                                 END,
                updated_by = $2,
                updated_at = now()
          WHERE id = $3
            AND tenant_id = $4
            AND deleted_at IS NULL
        RETURNING *`,
        [status, actor.userId, id, actor.tenantId],
      );
      if (!updated.rows[0]) throw new NotFoundError("OrganizationUnit", id);

      const action =
        status === "active"
          ? "organization_unit.activated"
          : status === "inactive"
            ? "organization_unit.deactivated"
            : "organization_unit.tombstoned";

      await recordGovernedAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action,
        entityType: "organization_unit",
        entityId: id,
        metadata: {
          previousStatus: current,
          previousIsActive: target.rows[0].is_active,
          status,
          isActive: status === "active",
        },
      });

      return mapRow(updated.rows[0]);
    });
  }

  /**
   * The two facts that decide whether a unit may hold `status = 'active'`:
   * its parent (if it has one) and its owning Legal Entity. Both must be active
   * themselves — §4.5 structure limits and the G0 acceptance table (A4:
   * "Activate OU with inactive parent → ConflictError"). Rows are locked so a
   * parent cannot be deactivated concurrently after the check passes.
   *
   * Extracted so the same rule runs on every activation request, including one
   * that arrives for a unit that is already active: the pre-Epic-5 code checked
   * on every call and `tahap-b-lifecycle` depends on that.
   */
  private async assertActivationContext(
    client: PoolClient,
    tenantId: string,
    target: { parent_id: string | null; legal_entity_id: string },
  ): Promise<void> {
    if (target.parent_id) {
      const parent = await client.query(
        `SELECT 1 FROM organization_units
         WHERE id = $1 AND tenant_id = $2 AND is_active = true
           AND status = 'active'
           AND deleted_at IS NULL FOR UPDATE`,
        [target.parent_id, tenantId],
      );
      if (!parent.rows[0]) {
        throw new ConflictError(
          "Parent Organization Unit is inactive. Activate it first.",
        );
      }
    }

    const legalEntity = await client.query(
      `SELECT 1 FROM legal_entities
       WHERE id = $1 AND tenant_id = $2 AND is_active = true
         AND status = 'active'
         AND deleted_at IS NULL FOR UPDATE`,
      [target.legal_entity_id, tenantId],
    );
    if (!legalEntity.rows[0]) {
      throw new ConflictError(
        "Owning Legal Entity is inactive. Activate it first.",
      );
    }
  }

  private async selectRow(
    client: PoolClient,
    id: string,
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    const result = await client.query(
      `SELECT * FROM organization_units WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, tenantId],
    );
    return result.rows[0] ?? {};
  }
}
