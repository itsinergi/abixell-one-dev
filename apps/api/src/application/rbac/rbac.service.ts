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
}
