import type {
  CreateEmployeePlacementInput,
  EmployeePlacement,
  EmployeePlacementRepository,
} from "../../domain/employee/employee-placement.entity.js";
import { ConflictError, NotFoundError } from "../../domain/shared-kernel/errors.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import type { RbacService } from "../rbac/rbac.service.js";

/**
 * Employee Placement application service (Epic 6 Gelombang 2).
 *
 * Placement is an immutable effective-dated assignment of an employee to:
 * - One primary placement (non-overlapping per employee/date)
 * - Optional secondary placements (no overlap enforcement)
 *
 * Eligibility:
 * - Employee Profile must link Individual BP with active `employee` role
 * - Legal Entity and Organization Unit must be active, same tenant
 * - Organization Unit must belong to the Legal Entity
 * - Department (optional) must be active, same tenant; never participates in scope
 *
 * Writes are governed (transaction + audit); reads enforce Data Scope.
 */
export class EmployeePlacementService {
  constructor(
    private readonly repo: EmployeePlacementRepository,
    private readonly rbac: RbacService,
  ) {}

  async getById(actor: ActorContext, id: string): Promise<EmployeePlacement> {
    await this.rbac.requirePermission(actor, "employee_profile.read");
    const placement = await this.repo.findById(actor.tenantId, id);
    if (!placement) throw new NotFoundError("EmployeePlacement", id);
    // Enforce Data Scope: actor must have coverage for the placement's OU + LE.
    // Mirrors the write path's governance (epic-6-g2 option B).
    await this.rbac.requireOrganizationUnitScopeForActor(actor, placement.organizationUnitId);
    await this.rbac.requireLegalEntityScopedPermissionForActor(
      actor,
      "employee_profile.read",
      placement.legalEntityId,
    );
    return placement;
  }

  async getActiveAtDate(
    actor: ActorContext,
    employeeProfileId: string,
    dateAt: Date,
  ): Promise<{ primary: EmployeePlacement | null; secondary: EmployeePlacement[] }> {
    await this.rbac.requirePermission(actor, "employee_profile.read");
    const result = await this.repo.getActiveAtDate(actor.tenantId, employeeProfileId, dateAt);
    // Enforce Data Scope: filter results to only placements the actor can access.
    // Placement is accessible if actor holds Data Scope for its OU AND LE.
    const filtered: typeof result = {
      primary: null,
      secondary: [],
    };
    if (result.primary) {
      const canAccess =
        (await this.rbac.isActiveOrganizationUnitScopeCovered(
          actor,
          result.primary.organizationUnitId,
        )) &&
        (await this.rbac.isLegalEntityScopeCovered(actor, result.primary.legalEntityId));
      if (canAccess) {
        filtered.primary = result.primary;
      }
    }
    for (const secondary of result.secondary) {
      const canAccess =
        (await this.rbac.isActiveOrganizationUnitScopeCovered(
          actor,
          secondary.organizationUnitId,
        )) &&
        (await this.rbac.isLegalEntityScopeCovered(actor, secondary.legalEntityId));
      if (canAccess) {
        filtered.secondary.push(secondary);
      }
    }
    return filtered;
  }

  async listByEmployee(
    actor: ActorContext,
    employeeProfileId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<EmployeePlacement[]> {
    await this.rbac.requirePermission(actor, "employee_profile.read");
    const placements = await this.repo.listByEmployee(actor.tenantId, employeeProfileId, options);
    // Enforce Data Scope: filter to only placements the actor can access.
    // Placement is accessible if actor holds Data Scope for its OU AND LE.
    const filtered: EmployeePlacement[] = [];
    for (const placement of placements) {
      const canAccess =
        (await this.rbac.isActiveOrganizationUnitScopeCovered(
          actor,
          placement.organizationUnitId,
        )) &&
        (await this.rbac.isLegalEntityScopeCovered(actor, placement.legalEntityId));
      if (canAccess) {
        filtered.push(placement);
      }
    }
    return filtered;
  }

  async createPlacement(
    actor: ActorContext,
    input: CreateEmployeePlacementInput,
  ): Promise<EmployeePlacement> {
    await this.rbac.requirePermission(actor, "employee_profile.manage");

    // Validate employee profile: must be Individual BP with active `employee` role.
    // BP eligibility checked atomically inside repository/governed transaction.
    // Service validates only scalars here; repository validates BP + referential integrity.

    // Validate date range.
    const effectiveTo = input.effectiveTo ?? null;
    if (effectiveTo && effectiveTo <= input.effectiveFrom) {
      throw new ConflictError(
        "effective_to must be greater than effective_from or NULL",
      );
    }

    // Validate reason is not blank (DB also checks via constraint).
    if (!input.reason || !input.reason.trim()) {
      throw new ConflictError("Placement reason cannot be blank");
    }

    // Repository validates BP, Legal Entity, Organization Unit, Department eligibility
    // inside the same governed transaction, avoiding TOCTOU race.
    return this.repo.create(actor.tenantId, input, actor);
  }

  async closePlacement(
    actor: ActorContext,
    id: string,
    effectiveTo: Date,
  ): Promise<EmployeePlacement> {
    await this.rbac.requirePermission(actor, "employee_profile.manage");

    const placement = await this.repo.findById(actor.tenantId, id);
    if (!placement) throw new NotFoundError("EmployeePlacement", id);

    if (placement.effectiveTo !== null) {
      throw new ConflictError("Placement is already closed");
    }

    if (effectiveTo <= placement.effectiveFrom) {
      throw new ConflictError(
        "effective_to must be greater than placement's effective_from",
      );
    }

    return this.repo.close(actor.tenantId, id, effectiveTo, actor);
  }
}
