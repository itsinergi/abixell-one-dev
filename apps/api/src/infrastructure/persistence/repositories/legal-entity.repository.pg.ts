import type { Pool, PoolClient } from "pg";
import type {
  CreateLegalEntityAddressInput,
  CreateLegalEntityInput,
  LegalEntity,
  LegalEntityAddress,
  LegalEntityAddressType,
  LegalEntityRepository,
  LifecycleStatus,
  UpdateLegalEntityAddressInput,
  UpdateLegalEntityInput,
} from "../../../domain/legal-entity/legal-entity.entity.js";
import type { ActorContext } from "../../../domain/shared-kernel/audit-context.js";
import { ConflictError, NotFoundError } from "../../../domain/shared-kernel/errors.js";
import {
  inGovernedTransaction,
  requireTransactionActorPermission,
  recordGovernedAudit,
} from "./governed-transaction.js";

/** PostgreSQL unique-violation. The repository translates it so a duplicate
 * address type, or a second root Central, never surfaces as a 500. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === UNIQUE_VIOLATION
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): LegalEntity {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    registrationNo: row.registration_no,
    displayName: row.display_name ?? null,
    country: row.country ?? null,
    timezone: row.timezone ?? null,
    baseCurrency: row.base_currency ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    status: row.status as LifecycleStatus,
    isActive: row.is_active,
    deactivatedAt: row.deactivated_at ? new Date(row.deactivated_at) : null,
    deactivatedBy: row.deactivated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapAddressRow(row: any): LegalEntityAddress {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    legalEntityId: row.legal_entity_id,
    addressType: row.address_type as LegalEntityAddressType,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    postalCode: row.postal_code,
    country: row.country,
    isActive: row.is_active,
    deactivatedAt: row.deactivated_at ? new Date(row.deactivated_at) : null,
    deactivatedBy: row.deactivated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * G0 §5 transition policy, stated once. `null` means "not a legal transition":
 * the caller reports a `ConflictError` naming the attempt rather than silently
 * accepting it.
 *
 * A no-op (`active → active`) is NOT a transition and is allowed, so the
 * idempotent `POST /legal-entities/:id/activate` keeps working; every real
 * move must be one of the four the contract lists.
 */
function isAllowedTransition(from: LifecycleStatus, to: LifecycleStatus): boolean {
  if (from === to) return true;
  if (from === "draft" && to === "active") return true;
  if (from === "active" && to === "inactive") return true;
  if (from === "inactive" && to === "active") return true;
  if (from === "inactive" && to === "tombstone") return true;
  return false;
}

/**
 * Inactive-mutation guard (roadmap §4.5 step 7). A write that targets a Legal
 * Entity which is `inactive`, `tombstone` or `deleted` is refused: reads keep
 * resolving history, but nothing new may be attached to a retired entity. The
 * one write that is NOT refused is the transition out of `inactive`
 * (`inactive → active`), which the contract lists as legal — that path goes
 * through `updateStatus`, never through a content write.
 */
function assertMutable(status: LifecycleStatus, what: string): void {
  if (status === "inactive" || status === "tombstone" || status === "deleted") {
    throw new ConflictError(
      `${what} is ${status}; no further changes are allowed. Reactivate it first.`,
    );
  }
}

export class PgLegalEntityRepository implements LegalEntityRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Atomic creation (§4.5 Putaran 4 / roadmap §4.5 step 8).
   *
   * The Legal Entity and its single root Central Organization Unit are written
   * in ONE governed transaction. If the Central insert fails — the unique
   * partial index, the structure trigger, or any other error — the whole
   * transaction rolls back and the Legal Entity does not exist. Both inserts
   * audit inside the same transaction, so the audit trail cannot outlive a
   * rolled-back write either.
   */
  async create(input: CreateLegalEntityInput, actor: ActorContext): Promise<LegalEntity> {
    return inGovernedTransaction(this.pool, input.tenantId, async (client) => {
      await requireTransactionActorPermission(client, actor, "legal_entity.create");

      const status: LifecycleStatus = input.status ?? "draft";
      // `is_active` is derived, never passed independently: the CHECK
      // constraint `is_active = (status = 'active')` is what makes the two
      // representations impossible to disagree.
      const isActive = status === "active";

      const inserted = await client.query(
        `INSERT INTO legal_entities
           (tenant_id, name, registration_no, display_name, country, timezone,
            base_currency, email, phone, status, is_active, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
         RETURNING *`,
        [
          input.tenantId,
          input.name,
          input.registrationNo ?? null,
          input.displayName ?? null,
          input.country ?? null,
          input.timezone ?? null,
          input.baseCurrency ?? null,
          input.email ?? null,
          input.phone ?? null,
          status,
          isActive,
          actor.userId,
        ],
      );
      if (!inserted.rows[0]) throw new NotFoundError("Tenant", input.tenantId);
      const legalEntity = mapRow(inserted.rows[0]);

      await recordGovernedAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "legal_entity.created",
        entityType: "legal_entity",
        entityId: legalEntity.id,
        metadata: { name: legalEntity.name, status: legalEntity.status },
      });

      // Exactly one root Central per Legal Entity, created here and only here.
      // `parent_id = NULL` and `unit_type = 'Central'` are what the unique
      // partial index `organization_units_one_central_per_legal_entity` and the
      // structure trigger key on. Created `active`: a Legal Entity that is
      // `draft` still owns a live structure root, and the root is what the
      // hierarchy is built from once the entity is activated.
      const central = await client.query(
        `INSERT INTO organization_units
           (tenant_id, legal_entity_id, parent_id, name, unit_type, status,
            is_active, created_by, updated_by)
         VALUES ($1, $2, NULL, 'Central', 'Central', 'active', true, $3, $3)
         RETURNING id`,
        [input.tenantId, legalEntity.id, actor.userId],
      );

      await recordGovernedAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "organization_unit.created",
        entityType: "organization_unit",
        entityId: central.rows[0].id as string,
        metadata: {
          name: "Central",
          parentId: null,
          unitType: "Central",
          rootCentral: true,
          legalEntityId: legalEntity.id,
        },
      });

      return legalEntity;
    });
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

  /**
   * Profile update. Content writes never touch `status`/`is_active` — the
   * lifecycle is only reachable through `updateStatus` — and a profile edit
   * on a retired Legal Entity is refused by the inactive-mutation guard.
   */
  async update(
    id: string,
    input: UpdateLegalEntityInput,
    actor: ActorContext,
  ): Promise<LegalEntity> {
    return inGovernedTransaction(this.pool, actor.tenantId, async (client) => {
      await requireTransactionActorPermission(client, actor, "legal_entity.update");

      // Tenant ownership is revalidated inside the transaction: a
      // cross-tenant id is reported as absent rather than forbidden, so the
      // endpoint never confirms that it exists elsewhere.
      const target = await client.query(
        `SELECT id, status FROM legal_entities
          WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
          FOR UPDATE`,
        [id, actor.tenantId],
      );
      if (!target.rows[0]) throw new NotFoundError("LegalEntity", id);
      assertMutable(target.rows[0].status as LifecycleStatus, "Legal Entity");

      // `tenant_id` is absent from the UPDATE: immutable after creation.
      const updated = await client.query(
        `UPDATE legal_entities
            SET name = $1,
                registration_no = $2,
                display_name = $3,
                country = $4,
                timezone = $5,
                base_currency = $6,
                email = $7,
                phone = $8,
                updated_by = $9,
                updated_at = now()
          WHERE id = $10
            AND tenant_id = $11
            AND deleted_at IS NULL
        RETURNING *`,
        [
          input.name,
          input.registrationNo ?? null,
          input.displayName ?? null,
          input.country ?? null,
          input.timezone ?? null,
          input.baseCurrency ?? null,
          input.email ?? null,
          input.phone ?? null,
          actor.userId,
          id,
          actor.tenantId,
        ],
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

  /** `setActive` is the boolean face of `updateStatus`: `true` means the
   * `active` state, `false` the `inactive` one, and the transition policy is
   * applied in one place. */
  async setActive(id: string, isActive: boolean, actor: ActorContext): Promise<LegalEntity> {
    return this.updateStatus(id, isActive ? "active" : "inactive", actor);
  }

  async updateStatus(
    id: string,
    status: LifecycleStatus,
    actor: ActorContext,
  ): Promise<LegalEntity> {
    return inGovernedTransaction(this.pool, actor.tenantId, async (client) => {
      // The capability is the direction of travel: entering `active` needs
      // `legal_entity.activate`, everything else needs `legal_entity.deactivate`.
      await requireTransactionActorPermission(
        client,
        actor,
        status === "active" ? "legal_entity.activate" : "legal_entity.deactivate",
      );

      const target = await client.query(
        `SELECT id, is_active, status FROM legal_entities
          WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
          FOR UPDATE`,
        [id, actor.tenantId],
      );
      if (!target.rows[0]) throw new NotFoundError("LegalEntity", id);
      const current = target.rows[0].status as LifecycleStatus;

      // A tombstoned or deleted Legal Entity is terminal for this wave: it may
      // not be reactivated, and it may not be moved again.
      if (current === "tombstone" || current === "deleted") {
        throw new ConflictError(
          `Legal Entity is ${current} and cannot be moved to '${status}'`,
        );
      }
      if (current === status) {
        // Re-deactivating an inactive Legal Entity is refused: the guard on an
        // inactive target says so explicitly. Re-activating an already-active
        // one is a no-op, because `active → active` is not a move at all.
        if (current === "inactive") {
          throw new ConflictError("Legal Entity is already inactive");
        }
        return mapRow(await this.selectRow(client, id, actor.tenantId));
      }
      if (!isAllowedTransition(current, status)) {
        throw new ConflictError(
          `Legal Entity transition '${current}' → '${status}' is not allowed`,
        );
      }

      // Leaving `active` needs every Organization Unit of the Legal Entity to
      // be inactive already: deactivation never cascades downwards, so this
      // guard is what stops a live unit from being stranded under a retired
      // entity. Rows are locked so a unit cannot be activated concurrently
      // after this check passes.
      //
      // KNOWN AND FOUNDER-DEFERRED (decision 2026-09-29, item [3A]): the root
      // Central is created active, follows §4.5 Putaran 4 (it cannot be
      // deactivated, re-typed, moved or deleted), and therefore keeps this
      // guard from being satisfied through the API — an `active → inactive`
      // move on a Legal Entity whose only live unit is its own root is refused
      // here and reachable only by a direct write. The resolution — deactivate
      // the root Central together with its Legal Entity, or exempt the root
      // from this guard — is ruled Gelombang 2 work (it lands with the
      // hierarchy validation of §4.5 step 12), not Wave 1. The
      // inactive-mutation guard in `assertMutable` is consequently exercised
      // on Organization Units, and on Legal Entities only through a direct
      // write, until that wave lands.
      if (status === "inactive" || status === "tombstone") {
        // The root Central is excluded from this check: it is created active
        // and the Organization Unit repository refuses to ever deactivate it
        // directly (`Root Central Organization Unit cannot be deactivated`),
        // so requiring it inactive here would make every Legal Entity
        // permanently un-deactivatable — the unsatisfiable-guard trap this
        // file's module comment warns about. Deactivating the Legal Entity
        // takes its structure out of active use without mutating the root
        // Central's own row; reactivating restores both to the same state
        // they were in before (§4.5 decision 2026-09-29, item [3A]).
        const activeUnits = await client.query(
          `SELECT 1
             FROM organization_units
            WHERE legal_entity_id = $1
              AND tenant_id = $2
              AND is_active = true
              AND deleted_at IS NULL
              AND NOT (unit_type = 'Central' AND parent_id IS NULL)
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
            SET status = $1,
                is_active = ($1 = 'active'),
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
      if (!updated.rows[0]) throw new NotFoundError("LegalEntity", id);

      const action =
        status === "active"
          ? "legal_entity.activated"
          : status === "inactive"
            ? "legal_entity.deactivated"
            : "legal_entity.tombstoned";

      await recordGovernedAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action,
        entityType: "legal_entity",
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

  /** Resolve the owning Legal Entity inside the caller's transaction, or
   * report it as absent. This is the same-tenant half of the ownership rule;
   * the composite FK on `legal_entity_addresses` is the database backstop. */
  private async lockOwnedLegalEntity(
    client: PoolClient,
    legalEntityId: string,
    tenantId: string,
    guardMutation: boolean,
  ): Promise<LifecycleStatus> {
    const result = await client.query(
      `SELECT id, status FROM legal_entities
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [legalEntityId, tenantId],
    );
    if (!result.rows[0]) throw new NotFoundError("LegalEntity", legalEntityId);
    const status = result.rows[0].status as LifecycleStatus;
    if (guardMutation) assertMutable(status, "Legal Entity");
    return status;
  }

  private async selectRow(
    client: PoolClient,
    id: string,
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    const result = await client.query(
      `SELECT * FROM legal_entities WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, tenantId],
    );
    return result.rows[0] ?? {};
  }

  /**
   * Reads stay available for retired addresses (§4.5: an address an old
   * invoice referenced must still resolve), so the list is not filtered by
   * `is_active` — each row carries `isActive` for the caller to decide. The
   * landed table has no `deleted` marker (address lifecycle is
   * deactivate-then-insert, never a delete), so there is nothing else to
   * exclude.
   */
  async listAddresses(legalEntityId: string, actor: ActorContext): Promise<LegalEntityAddress[]> {
    // Resolve the Legal Entity first: a cross-tenant id must be reported as
    // absent, never as an empty list, so the caller learns nothing about the
    // other tenant's rows.
    const owner = await this.pool.query(
      `SELECT id FROM legal_entities WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [legalEntityId, actor.tenantId],
    );
    if (!owner.rows[0]) throw new NotFoundError("LegalEntity", legalEntityId);

    const result = await this.pool.query(
      `SELECT * FROM legal_entity_addresses
        WHERE tenant_id = $1
          AND legal_entity_id = $2
        ORDER BY address_type ASC, created_at ASC`,
      [actor.tenantId, legalEntityId],
    );
    return result.rows.map(mapAddressRow);
  }

  async createAddress(
    legalEntityId: string,
    input: CreateLegalEntityAddressInput,
    actor: ActorContext,
  ): Promise<LegalEntityAddress> {
    return inGovernedTransaction(this.pool, actor.tenantId, async (client) => {
      await requireTransactionActorPermission(client, actor, "legal_entity.update");
      await this.lockOwnedLegalEntity(client, legalEntityId, actor.tenantId, true);

      let created;
      try {
        created = await client.query(
          `INSERT INTO legal_entity_addresses
             (tenant_id, legal_entity_id, address_type, line1, line2, city,
              postal_code, country, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
           RETURNING *`,
          [
            actor.tenantId,
            legalEntityId,
            input.addressType,
            input.line1,
            input.line2 ?? null,
            input.city ?? null,
            input.postalCode ?? null,
            input.country ?? null,
            actor.userId,
          ],
        );
      } catch (error) {
        // `legal_entity_addresses_active_type_unique` allows exactly one
        // ACTIVE address per (Legal Entity, type). Superseding an address is a
        // deactivate-then-insert, so a second active row is a conflict the
        // caller can act on — not a server error.
        if (isUniqueViolation(error)) {
          throw new ConflictError(
            `Legal Entity already has an active '${input.addressType}' address. Deactivate it first.`,
          );
        }
        throw error;
      }

      await recordGovernedAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "legal_entity.address.created",
        entityType: "legal_entity_address",
        entityId: created.rows[0].id as string,
        metadata: {
          legalEntityId,
          addressType: input.addressType,
          line1: input.line1,
        },
      });

      return mapAddressRow(created.rows[0]);
    });
  }

  async updateAddress(
    legalEntityId: string,
    addressId: string,
    input: UpdateLegalEntityAddressInput,
    actor: ActorContext,
  ): Promise<LegalEntityAddress> {
    return inGovernedTransaction(this.pool, actor.tenantId, async (client) => {
      await requireTransactionActorPermission(client, actor, "legal_entity.update");
      await this.lockOwnedLegalEntity(client, legalEntityId, actor.tenantId, true);

      // `tenant_id` and `legal_entity_id` are absent from the UPDATE: both are
      // immutable, and the WHERE clause pins the address to the Legal Entity
      // the caller already resolved in this tenant.
      const updated = await client.query(
        `UPDATE legal_entity_addresses
            SET line1 = COALESCE($1, line1),
                line2 = CASE WHEN $2::boolean THEN $3 ELSE line2 END,
                city = CASE WHEN $4::boolean THEN $5 ELSE city END,
                postal_code = CASE WHEN $6::boolean THEN $7 ELSE postal_code END,
                country = CASE WHEN $8::boolean THEN $9 ELSE country END,
                updated_by = $10,
                updated_at = now()
          WHERE id = $11
            AND legal_entity_id = $12
            AND tenant_id = $13
        RETURNING *`,
        [
          input.line1 ?? null,
          input.line2 !== undefined,
          input.line2 ?? null,
          input.city !== undefined,
          input.city ?? null,
          input.postalCode !== undefined,
          input.postalCode ?? null,
          input.country !== undefined,
          input.country ?? null,
          actor.userId,
          addressId,
          legalEntityId,
          actor.tenantId,
        ],
      );
      if (!updated.rows[0]) throw new NotFoundError("LegalEntityAddress", addressId);

      await recordGovernedAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "legal_entity.address.updated",
        entityType: "legal_entity_address",
        entityId: addressId,
        metadata: { legalEntityId, addressType: updated.rows[0].address_type },
      });

      return mapAddressRow(updated.rows[0]);
    });
  }

  /** Address lifecycle is `is_active` only — never a hard delete, so the
   * address an old document referenced keeps resolving. */
  async deactivateAddress(
    legalEntityId: string,
    addressId: string,
    actor: ActorContext,
  ): Promise<LegalEntityAddress> {
    return inGovernedTransaction(this.pool, actor.tenantId, async (client) => {
      await requireTransactionActorPermission(client, actor, "legal_entity.update");
      await this.lockOwnedLegalEntity(client, legalEntityId, actor.tenantId, true);

      const updated = await client.query(
        `UPDATE legal_entity_addresses
            SET is_active = false,
                deactivated_at = now(),
                deactivated_by = $1,
                updated_by = $1,
                updated_at = now()
          WHERE id = $2
            AND legal_entity_id = $3
            AND tenant_id = $4
            AND is_active = true
        RETURNING *`,
        [actor.userId, addressId, legalEntityId, actor.tenantId],
      );
      if (!updated.rows[0]) {
        // Either the address is not this Legal Entity's / not this tenant's,
        // or it was already inactive. Both are "nothing to deactivate" and are
        // reported as absent, matching the rest of the lifecycle surface.
        throw new NotFoundError("LegalEntityAddress", addressId);
      }

      await recordGovernedAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "legal_entity.address.deactivated",
        entityType: "legal_entity_address",
        entityId: addressId,
        metadata: { legalEntityId, addressType: updated.rows[0].address_type },
      });

      return mapAddressRow(updated.rows[0]);
    });
  }
}
