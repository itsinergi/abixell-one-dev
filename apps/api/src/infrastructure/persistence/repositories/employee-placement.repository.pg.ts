import type { Pool, PoolClient } from "pg";
import type {
  CreateEmployeePlacementInput,
  EmployeePlacement,
  EmployeePlacementRepository,
} from "../../../domain/employee/employee-placement.entity.js";
import type { ActorContext } from "../../../domain/shared-kernel/audit-context.js";
import { ConflictError, NotFoundError } from "../../../domain/shared-kernel/errors.js";
import {
  inGovernedTransaction,
  recordGovernedAudit,
  requireTransactionActorPermission,
} from "./governed-transaction.js";

const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
const EXCLUSION_VIOLATION = "23P01";

function isPgCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === code
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): EmployeePlacement {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    employeeProfileId: row.employee_profile_id,
    placementType: row.placement_type,
    legalEntityId: row.legal_entity_id,
    organizationUnitId: row.organization_unit_id,
    departmentId: row.department_id,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    recordedAt: row.recorded_at,
    reason: row.reason,
    actorUserId: row.actor_user_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

/**
 * Employee placement persistence (Epic 6 Gelombang 2).
 *
 * Writes are governed and validate placement eligibility inside the same
 * transaction that inserts/closes history. Department is reporting-only: it is
 * validated for existence/active state, but never passed as Data Scope.
 */
export class PgEmployeePlacementRepository implements EmployeePlacementRepository {
  constructor(private readonly pool: Pool) {}

  async findById(tenantId: string, id: string): Promise<EmployeePlacement | null> {
    const result = await this.pool.query(
      `SELECT * FROM employee_placement_history WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async getActiveAtDate(
    tenantId: string,
    employeeProfileId: string,
    dateAt: Date,
  ): Promise<{ primary: EmployeePlacement | null; secondary: EmployeePlacement[] }> {
    const result = await this.pool.query(
      `SELECT *
         FROM employee_placement_history
        WHERE tenant_id = $1
          AND employee_profile_id = $2
          AND effective_from <= $3
          AND (effective_to IS NULL OR effective_to > $3)
        ORDER BY
          CASE WHEN placement_type = 'primary' THEN 0 ELSE 1 END,
          effective_from DESC,
          recorded_at DESC`,
      [tenantId, employeeProfileId, dateAt],
    );

    const placements = result.rows.map(mapRow);
    return {
      primary: placements.find((placement) => placement.placementType === "primary") ?? null,
      secondary: placements.filter((placement) => placement.placementType === "secondary"),
    };
  }

  async listByEmployee(
    tenantId: string,
    employeeProfileId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<EmployeePlacement[]> {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;
    const result = await this.pool.query(
      `SELECT *
         FROM employee_placement_history
        WHERE tenant_id = $1
          AND employee_profile_id = $2
        ORDER BY effective_from DESC, recorded_at DESC
        LIMIT $3 OFFSET $4`,
      [tenantId, employeeProfileId, limit, offset],
    );
    return result.rows.map(mapRow);
  }

  async create(
    tenantId: string,
    input: CreateEmployeePlacementInput,
    actor: ActorContext,
  ): Promise<EmployeePlacement> {
    return inGovernedTransaction(this.pool, tenantId, async (client) => {
      await requireTransactionActorPermission(
        client,
        actor,
        "employee_profile.manage",
        input.organizationUnitId,
        input.legalEntityId,
      );

      await this.assertEmployeeProfileEligible(client, tenantId, input.employeeProfileId);
      await this.assertLegalEntityActive(client, tenantId, input.legalEntityId);
      await this.assertOrganizationUnitActive(
        client,
        tenantId,
        input.organizationUnitId,
        input.legalEntityId,
      );
      if (input.departmentId) {
        await this.assertDepartmentActive(client, tenantId, input.departmentId);
      }

      let created;
      try {
        created = await client.query(
          `INSERT INTO employee_placement_history
             (tenant_id, employee_profile_id, placement_type, legal_entity_id,
              organization_unit_id, department_id, effective_from, effective_to,
              published_by, reason, actor_user_id, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9,$9,$9)
           RETURNING *`,
          [
            tenantId,
            input.employeeProfileId,
            input.placementType,
            input.legalEntityId,
            input.organizationUnitId,
            input.departmentId ?? null,
            input.effectiveFrom,
            input.effectiveTo ?? null,
            actor.userId,
            input.reason.trim(),
          ],
        );
      } catch (error) {
        this.mapWriteError(error);
      }

      await recordGovernedAudit(client, {
        tenantId,
        actorUserId: actor.userId,
        action: "employee_placement.created",
        entityType: "employee_placement",
        entityId: created.rows[0].id as string,
        metadata: {
          employeeProfileId: input.employeeProfileId,
          placementType: input.placementType,
          legalEntityId: input.legalEntityId,
          organizationUnitId: input.organizationUnitId,
          departmentId: input.departmentId ?? null,
          effectiveFrom: input.effectiveFrom.toISOString(),
          effectiveTo: input.effectiveTo?.toISOString() ?? null,
          reason: input.reason.trim(),
        },
      });

      return mapRow(created.rows[0]);
    });
  }

  async close(
    tenantId: string,
    id: string,
    effectiveTo: Date,
    actor: ActorContext,
  ): Promise<EmployeePlacement> {
    return inGovernedTransaction(this.pool, tenantId, async (client) => {
      const target = await client.query(
        `SELECT *
           FROM employee_placement_history
          WHERE id = $1
            AND tenant_id = $2
          FOR UPDATE`,
        [id, tenantId],
      );
      if (!target.rows[0]) throw new NotFoundError("EmployeePlacement", id);

      const placement = mapRow(target.rows[0]);
      await requireTransactionActorPermission(
        client,
        actor,
        "employee_profile.manage",
        placement.organizationUnitId,
        placement.legalEntityId,
      );

      if (placement.effectiveTo !== null) {
        throw new ConflictError("Placement is already closed");
      }
      if (effectiveTo <= placement.effectiveFrom) {
        throw new ConflictError("effective_to must be greater than placement's effective_from");
      }

      const updated = await client.query(
        `UPDATE employee_placement_history
            SET effective_to = $1,
                updated_by = $2,
                updated_at = now()
          WHERE id = $3
            AND tenant_id = $4
        RETURNING *`,
        [effectiveTo, actor.userId, id, tenantId],
      );

      await recordGovernedAudit(client, {
        tenantId,
        actorUserId: actor.userId,
        action: "employee_placement.closed",
        entityType: "employee_placement",
        entityId: id,
        metadata: {
          employeeProfileId: placement.employeeProfileId,
          placementType: placement.placementType,
          effectiveFrom: placement.effectiveFrom.toISOString(),
          effectiveTo: effectiveTo.toISOString(),
        },
      });

      return mapRow(updated.rows[0]);
    });
  }

  private async assertEmployeeProfileEligible(
    client: PoolClient,
    tenantId: string,
    employeeProfileId: string,
  ): Promise<void> {
    const result = await client.query(
      `SELECT ep.id,
              ep.status AS employee_status,
              bp.bp_type,
              bp.lifecycle_status AS bp_status,
              br.id AS employee_role_id
         FROM employee_profiles ep
         JOIN business_partners bp
           ON bp.id = ep.business_partner_id
          AND bp.tenant_id = ep.tenant_id
         LEFT JOIN bp_roles br
           ON br.business_partner_id = bp.id
          AND br.tenant_id = bp.tenant_id
          AND br.role_type = 'employee'
          AND br.status = 'active'
        WHERE ep.id = $1
          AND ep.tenant_id = $2
        FOR UPDATE OF ep, bp`,
      [employeeProfileId, tenantId],
    );
    const profile = result.rows[0];
    if (!profile) throw new NotFoundError("EmployeeProfile", employeeProfileId);
    if (profile.bp_type !== "individual") {
      throw new ConflictError("Employee Profile must link an Individual Business Partner");
    }
    if (profile.bp_status !== "active") {
      throw new ConflictError("Employee Profile Business Partner must be active");
    }
    if (profile.employee_status !== "active") {
      throw new ConflictError("Employee Profile must be active");
    }
    if (!profile.employee_role_id) {
      throw new ConflictError("Business Partner must have an active employee role");
    }
  }

  private async assertLegalEntityActive(
    client: PoolClient,
    tenantId: string,
    legalEntityId: string,
  ): Promise<void> {
    const result = await client.query(
      `SELECT id, status
         FROM legal_entities
        WHERE id = $1
          AND tenant_id = $2
          AND deleted_at IS NULL
        FOR SHARE`,
      [legalEntityId, tenantId],
    );
    const legalEntity = result.rows[0];
    if (!legalEntity) throw new NotFoundError("LegalEntity", legalEntityId);
    if (legalEntity.status !== "active") {
      throw new ConflictError("Legal Entity must be active");
    }
  }

  private async assertOrganizationUnitActive(
    client: PoolClient,
    tenantId: string,
    organizationUnitId: string,
    legalEntityId: string,
  ): Promise<void> {
    const result = await client.query(
      `SELECT id, legal_entity_id, status
         FROM organization_units
        WHERE id = $1
          AND tenant_id = $2
          AND deleted_at IS NULL
        FOR SHARE`,
      [organizationUnitId, tenantId],
    );
    const organizationUnit = result.rows[0];
    if (!organizationUnit) throw new NotFoundError("OrganizationUnit", organizationUnitId);
    if (organizationUnit.status !== "active") {
      throw new ConflictError("Organization Unit must be active");
    }
    if (organizationUnit.legal_entity_id !== legalEntityId) {
      throw new ConflictError("Organization Unit must belong to the selected Legal Entity");
    }
  }

  private async assertDepartmentActive(
    client: PoolClient,
    tenantId: string,
    departmentId: string,
  ): Promise<void> {
    const result = await client.query(
      `SELECT id, is_active
         FROM departments
        WHERE id = $1
          AND tenant_id = $2
        FOR SHARE`,
      [departmentId, tenantId],
    );
    const department = result.rows[0];
    if (!department) throw new NotFoundError("Department", departmentId);
    if (department.is_active !== true) {
      throw new ConflictError("Department must be active");
    }
  }

  private mapWriteError(error: unknown): never {
    if (isPgCode(error, EXCLUSION_VIOLATION)) {
      throw new ConflictError("Primary placement overlaps an existing primary placement");
    }
    if (isPgCode(error, CHECK_VIOLATION)) {
      throw new ConflictError("Employee placement violates a placement constraint");
    }
    if (isPgCode(error, FOREIGN_KEY_VIOLATION)) {
      throw new NotFoundError("Employee placement reference", "unknown");
    }
    throw error;
  }
}
