import type { RbacRepository } from "../../domain/rbac/rbac.entity.js";
import { ForbiddenError } from "../../domain/shared-kernel/errors.js";

/**
 * Authorization = Role Permission (what) + Data Scope (which data),
 * per 02-Identity-Security-RBAC-Foundation.md. This service is the single
 * place both axes are evaluated — HTTP routes call it, they never
 * hand-roll their own permission checks.
 */
export class RbacService {
  constructor(private readonly repo: RbacRepository) {}

  async getEffectivePermissions(userId: string): Promise<Set<string>> {
    return this.repo.getEffectivePermissionCodes(userId);
  }

  /** Throws ForbiddenError if the user does not hold `permissionCode`. */
  async requirePermission(userId: string, permissionCode: string): Promise<void> {
    const permissions = await this.repo.getEffectivePermissionCodes(userId);
    if (!permissions.has(permissionCode)) {
      throw new ForbiddenError(
        `Missing permission '${permissionCode}'`,
      );
    }
  }

  /**
   * Throws ForbiddenError unless the user has an assignment whose Data
   * Scope covers `targetOrganizationUnitId` — either a tenant-wide
   * assignment, or an organization_unit assignment matching exactly
   * (0B scope is exact-match only, see docs/decision-log.md gap analysis).
   */
  async requireOrganizationUnitScope(
    userId: string,
    targetOrganizationUnitId: string,
  ): Promise<void> {
    const assignments = await this.repo.getAssignments(userId);
    const covered = assignments.some(
      (a) =>
        a.scopeType === "tenant" ||
        (a.scopeType === "organization_unit" &&
          a.scopeOrganizationUnitId === targetOrganizationUnitId),
    );
    if (!covered) {
      throw new ForbiddenError(
        "Your assigned Data Scope does not cover this Organization Unit",
      );
    }
  }

  /** True if the user holds at least one tenant-wide assignment. */
  async hasTenantScope(userId: string): Promise<boolean> {
    const assignments = await this.repo.getAssignments(userId);
    return assignments.some((a) => a.scopeType === "tenant");
  }

  /**
   * Used by the Workflow Engine (Checkpoint 0D) to decide whether an actor
   * may act on a Workflow Assignment routed to a Role + Organization Unit
   * "queue" (per 04-Workflow-Approval-Engine-Foundation.md's Assignment
   * concept — a task is routed to whoever holds a role in a scope, not to
   * one pre-picked user).
   *
   * - `targetOrganizationUnitId = null` (a tenant-wide task): the actor
   *   must hold `roleCode` with a tenant-wide assignment.
   * - `targetOrganizationUnitId` set: the actor must hold `roleCode` with
   *   either a tenant-wide assignment, or an organization_unit assignment
   *   matching exactly (0B/ADR-0005 exact-match scope — a broader,
   *   tenant-wide role holder can still act on a narrower-scoped task).
   */
  async hasRoleCoveringScope(
    userId: string,
    roleCode: string,
    targetOrganizationUnitId: string | null,
  ): Promise<boolean> {
    const assignments = await this.repo.getAssignments(userId);
    return assignments.some((a) => {
      if (a.roleCode !== roleCode) return false;
      if (targetOrganizationUnitId === null) return a.scopeType === "tenant";
      return (
        a.scopeType === "tenant" ||
        (a.scopeType === "organization_unit" &&
          a.scopeOrganizationUnitId === targetOrganizationUnitId)
      );
    });
  }
}
