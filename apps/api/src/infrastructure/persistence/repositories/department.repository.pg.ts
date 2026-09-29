import type { Pool, PoolClient } from "pg";
import type {
  CreateDepartmentInput,
  Department,
  DepartmentRepository,
  UpdateDepartmentInput,
} from "../../../domain/department/department.entity.js";
import type { ActorContext } from "../../../domain/shared-kernel/audit-context.js";
import { ConflictError, NotFoundError } from "../../../domain/shared-kernel/errors.js";
import {
  inGovernedTransaction,
  requireTransactionActorPermission,
  recordGovernedAudit,
} from "./governed-transaction.js";

/** PostgreSQL unique-violation — the `code` business identifier, or a
 * department that has to be unique for another reason. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === UNIQUE_VIOLATION
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): Department {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    parentDepartmentId: row.parent_department_id,
    name: row.name,
    code: row.code,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Department persistence.
 *
 * ── Department is not an authorization scope (§4.5 principle 4) ───────────
 *
 * Every query in this file filters on `tenant_id` and nothing else. There is
 * deliberately no ancestor walk, no scope-aware listing, and no read of
 * `user_role_assignments`: a Department cannot widen or narrow what a caller
 * sees, and this repository is the place a future shortcut would be attempted,
 * so it is stated here rather than left to a reviewer to notice.
 *
 * The writes are still governed — `inGovernedTransaction` owns the Tenant row
 * lock and `requireTransactionActorPermission` re-checks the capability with
 * the session's active assignment pinned. That is a PERMISSION check; the
 * authority to edit master data is not the same claim as a Data Scope.
 */
export class PgDepartmentRepository implements DepartmentRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateDepartmentInput, actor: ActorContext): Promise<Department> {
    return inGovernedTransaction(this.pool, input.tenantId, async (client) => {
      await requireTransactionActorPermission(client, actor, "department.create");

      if (input.parentDepartmentId) {
        await this.assertParent(client, input.parentDepartmentId, actor.tenantId);
      }

      let created;
      try {
        created = await client.query(
          `INSERT INTO departments
             (tenant_id, parent_department_id, name, code, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $5)
           RETURNING *`,
          [
            input.tenantId,
            input.parentDepartmentId ?? null,
            input.name,
            input.code ?? null,
            actor.userId,
          ],
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictError(
            `Department code '${input.code}' already exists in this Tenant`,
          );
        }
        throw error;
      }

      await recordGovernedAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "department.created",
        entityType: "department",
        entityId: created.rows[0].id as string,
        metadata: {
          name: created.rows[0].name,
          code: created.rows[0].code,
          parentDepartmentId: created.rows[0].parent_department_id,
        },
      });

      return mapRow(created.rows[0]);
    });
  }

  async findById(id: string): Promise<Department | null> {
    const result = await this.pool.query(`SELECT * FROM departments WHERE id = $1`, [id]);
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async listByTenant(tenantId: string): Promise<Department[]> {
    const result = await this.pool.query(
      `SELECT * FROM departments WHERE tenant_id = $1 ORDER BY parent_department_id NULLS FIRST, name ASC`,
      [tenantId],
    );
    return result.rows.map(mapRow);
  }

  async update(
    id: string,
    input: UpdateDepartmentInput,
    actor: ActorContext,
  ): Promise<Department> {
    return inGovernedTransaction(this.pool, actor.tenantId, async (client) => {
      await requireTransactionActorPermission(client, actor, "department.update");

      const target = await client.query(
        `SELECT id, parent_department_id FROM departments
          WHERE id = $1 AND tenant_id = $2
          FOR UPDATE`,
        [id, actor.tenantId],
      );
      if (!target.rows[0]) throw new NotFoundError("Department", id);

      let parentDepartmentId: string | null = target.rows[0].parent_department_id;
      if (input.parentDepartmentId !== undefined) {
        parentDepartmentId = input.parentDepartmentId;
        if (parentDepartmentId) {
          if (parentDepartmentId === id) {
            throw new ConflictError("A Department cannot be its own parent");
          }
          await this.assertParent(client, parentDepartmentId, actor.tenantId);
          // A cycle would make the hierarchy unreadable. §4.5 step 12 owns
          // thorough hierarchy validation for Organization Units; for a
          // Department the cheap, complete check is "the new parent must not be
          // below the node being moved".
          const descendants = await client.query(
            `WITH RECURSIVE subtree AS (
               SELECT id FROM departments WHERE id = $1 AND tenant_id = $2
               UNION ALL
               SELECT d.id FROM departments d
                 JOIN subtree s ON d.parent_department_id = s.id
                WHERE d.tenant_id = $2
             )
             SELECT 1 FROM subtree WHERE id = $3`,
            [id, actor.tenantId, parentDepartmentId],
          );
          if (descendants.rows[0]) {
            throw new ConflictError(
              "A Department cannot be moved under one of its own descendants",
            );
          }
        }
      }

      let updated;
      try {
        updated = await client.query(
          `UPDATE departments
              SET name = COALESCE($1, name),
                  code = CASE WHEN $2::boolean THEN $3 ELSE code END,
                  parent_department_id = $4,
                  updated_by = $5,
                  updated_at = now()
            WHERE id = $6
              AND tenant_id = $7
          RETURNING *`,
          [
            input.name ?? null,
            input.code !== undefined,
            input.code ?? null,
            parentDepartmentId,
            actor.userId,
            id,
            actor.tenantId,
          ],
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictError(
            `Department code '${input.code}' already exists in this Tenant`,
          );
        }
        throw error;
      }
      if (!updated.rows[0]) throw new NotFoundError("Department", id);

      await recordGovernedAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "department.updated",
        entityType: "department",
        entityId: id,
        metadata: {
          name: updated.rows[0].name,
          code: updated.rows[0].code,
          parentDepartmentId: updated.rows[0].parent_department_id,
        },
      });

      return mapRow(updated.rows[0]);
    });
  }

  /**
   * Department lifecycle is `active` / `inactive` only (G0 §5: "no tombstone —
   * not a Data Scope"). Deactivation never cascades and nothing is deleted, so
   * a Department that a historical record mentions still resolves.
   */
  async setActive(id: string, isActive: boolean, actor: ActorContext): Promise<Department> {
    return inGovernedTransaction(this.pool, actor.tenantId, async (client) => {
      // Capability, not scope: `department.update` is a permission check.
      await requireTransactionActorPermission(client, actor, "department.update");

      const updated = await client.query(
        `UPDATE departments
            SET is_active = $1,
                updated_by = $2,
                updated_at = now()
          WHERE id = $3
            AND tenant_id = $4
        RETURNING *`,
        [isActive, actor.userId, id, actor.tenantId],
      );
      if (!updated.rows[0]) throw new NotFoundError("Department", id);

      await recordGovernedAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: isActive ? "department.activated" : "department.deactivated",
        entityType: "department",
        entityId: id,
        metadata: { isActive, name: updated.rows[0].name },
      });

      return mapRow(updated.rows[0]);
    });
  }

  /** Same-Tenant parent, or absent. The composite self-FK
   * `(tenant_id, parent_department_id) → departments(tenant_id, id)` is the
   * database backstop; this makes the failure a `NotFoundError` instead of a
   * constraint violation. */
  private async assertParent(
    client: PoolClient,
    parentDepartmentId: string,
    tenantId: string,
  ): Promise<void> {
    const parent = await client.query(
      `SELECT id FROM departments WHERE id = $1 AND tenant_id = $2`,
      [parentDepartmentId, tenantId],
    );
    if (!parent.rows[0]) throw new NotFoundError("Department", parentDepartmentId);
  }
}
