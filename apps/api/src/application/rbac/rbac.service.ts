import type {
  MyRoleAssignment,
  RbacRepository,
  UserRoleAssignment,
} from "../../domain/rbac/rbac.entity.js";
import type { OrganizationUnitRepository } from "../../domain/organization-unit/organization-unit.entity.js";
import { ForbiddenError } from "../../domain/shared-kernel/errors.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";

/**
 * Authorization = Role Permission (what) + Data Scope (which data),
 * per 02-Identity-Security-RBAC-Foundation.md. This service is the single
 * place both axes are evaluated — HTTP routes call it, they never
 * hand-roll their own permission checks.
 *
 * Epic 1 (§4.1 C) — separation of duties. Every method that answers "may the
 * actor do this" now reads the SESSION'S ACTIVE ASSIGNMENT, not the union of
 * everything the user holds. A user granted Creator and Approver must not be
 * able to approve in the Creator context merely because another Role they
 * hold would allow it.
 *
 * The methods that answer "what does this user hold" (getAssignments,
 * getMyAssignmentsWithScopeNames, getAssignmentsWithPermission, and the
 * repository's cross-user reads) deliberately keep the `userId` form: queue
 * routing, notification fan-out and admin review ask about a user in the
 * abstract, and pinning those to one session's choice would be wrong.
 */
export class RbacService {
  constructor(
    private readonly repo: RbacRepository,
    private readonly orgUnits: OrganizationUnitRepository,
  ) {}

  /** The union across every assignment the user holds. Informational only —
   * `/me` reports it so a user can see their full capability set before
   * switching context. Never an enforcement input. */
  async getEffectivePermissions(userId: string): Promise<Set<string>> {
    return this.repo.getEffectivePermissionCodes(userId);
  }

  /** The ACTIVE assignment's permission codes. This is the enforcement read:
   * a session with no effective assignment yields the empty set. */
  async getActivePermissions(actor: ActorContext): Promise<Set<string>> {
    return this.repo.getEffectivePermissionCodesForAssignment(
      actor.tenantId,
      actor.assignmentId,
    );
  }

  /**
   * Throws ForbiddenError unless the actor's ACTIVE Role carries
   * `permissionCode`.
   *
   * Three distinguishable failures collapse into one refusal, deliberately:
   * the session holds no effective assignment, the active Role lacks the
   * code, or the code belongs only to another Role the user holds. All three
   * mean "not in this context", and telling them apart would leak role
   * structure to a caller who is only entitled to a yes/no.
   */
  async requirePermission(actor: ActorContext, permissionCode: string): Promise<void> {
    if (actor.assignmentId === null) {
      throw new ForbiddenError(
        `No active Role in this session; switch to a Role that grants permission '${permissionCode}'`,
      );
    }
    const permissions = await this.getActivePermissions(actor);
    if (!permissions.has(permissionCode)) {
      throw new ForbiddenError(
        `Missing permission '${permissionCode}' in the active Role`,
      );
    }
  }

  /** Requires one authorization-effective assignment to carry every listed
   * actual permission grant. Permissions from separate roles are not combined. */
  async requirePermissionsOnSameAssignment(
    userId: string,
    permissionCodes: readonly string[],
  ): Promise<void> {
    const allowed = await this.repo.hasPermissionSetOnSameAssignment(
      userId,
      permissionCodes,
    );
    if (!allowed) {
      throw new ForbiddenError(
        `Missing same-assignment permissions '${permissionCodes.join("', '")}'`,
      );
    }
  }

  /** Epic 1 — same "all codes on one assignment" rule, pinned to the session's
   * active assignment. */
  async requirePermissionsOnActiveAssignment(
    actor: ActorContext,
    permissionCodes: readonly string[],
  ): Promise<void> {
    const allowed = await this.repo.hasPermissionSetForAssignment(
      actor.tenantId,
      actor.assignmentId,
      permissionCodes,
    );
    if (!allowed) {
      throw new ForbiddenError(
        `Missing same-assignment permissions '${permissionCodes.join("', '")}' in the active Role`,
      );
    }
  }

  /**
   * Canonical tenant-scoped authorization check for tenant-wide resources.
   * The requested permission and tenant Data Scope must come from the SAME
   * assignment; checking effective permissions and scope independently would
   * incorrectly combine authority from unrelated assignments.
   */
  async requireTenantScopedPermission(
    tenantId: string,
    userId: string,
    permissionCode: string,
  ): Promise<void> {
    const allowed = await this.repo.hasTenantScopedPermission(tenantId, userId, permissionCode);
    if (!allowed) {
      throw new ForbiddenError(
        `Missing tenant-scoped permission '${permissionCode}'`,
      );
    }
  }

  /** Epic 1 — the enforcement form: the ACTIVE assignment must be tenant-scoped
   * AND carry the permission. A tenant-scoped Role the user holds but has not
   * switched into does not authorize the action. */
  async requireTenantScopedPermissionForActor(
    actor: ActorContext,
    permissionCode: string,
  ): Promise<void> {
    const allowed = await this.repo.hasTenantScopedPermissionForAssignment(
      actor.tenantId,
      actor.assignmentId,
      permissionCode,
    );
    if (!allowed) {
      throw new ForbiddenError(
        `Missing tenant-scoped permission '${permissionCode}' in the active Role`,
      );
    }
  }

  /** Epic 4 step 11b — Window read-only state for one actor and one Window.
   * Passthrough so the enforcement plugin asks the same service every other
   * authorization question asks, and so the repository read has exactly one
   * consumer-shaped entry point. See `RbacRepository.getWindowAccessState`
   * for the semantics of `configured` and `writable`. */
  async getWindowAccessState(
    tenantId: string,
    userId: string,
    windowCode: string,
  ): Promise<{ configured: boolean; writable: boolean }> {
    return this.repo.getWindowAccessState(tenantId, userId, windowCode);
  }

  /** Epic 1 — the Window lock read against the ACTIVE Role only. Without this
   * a read-only Assignment could write through because another Role the user
   * holds happens to be writable. */
  async getWindowAccessStateForActor(
    actor: ActorContext,
    windowCode: string,
  ): Promise<{ configured: boolean; writable: boolean }> {
    return this.repo.getWindowAccessStateForAssignment(
      actor.tenantId,
      actor.assignmentId,
      windowCode,
    );
  }

  /**
   * Epic 1 — the enforcement form: throws unless the actor's ACTIVE
   * assignment's Data Scope covers `targetOrganizationUnitId` — a tenant-wide
   * active assignment, or an active organization_unit assignment on the unit
   * or one of its ANCESTORS. An ancestor assignment the user holds but has
   * not switched into grants nothing here.
   */
  async requireOrganizationUnitScopeForActor(
    actor: ActorContext,
    targetOrganizationUnitId: string,
  ): Promise<void> {
    const covered = await this.isActiveOrganizationUnitScopeCovered(
      actor,
      targetOrganizationUnitId,
    );
    if (!covered) {
      throw new ForbiddenError(
        "The active Role's Data Scope does not cover this Organization Unit",
      );
    }
  }

  async isActiveOrganizationUnitScopeCovered(
    actor: ActorContext,
    targetOrganizationUnitId: string,
  ): Promise<boolean> {
    if (actor.assignmentId === null) return false;
    if (actor.scopeType === "tenant") return true;
    if (
      actor.scopeType !== "organization_unit" ||
      actor.scopeOrganizationUnitId === null
    ) {
      return false;
    }
    const ancestorIds = await this.orgUnits.listAncestorIds(targetOrganizationUnitId);
    return new Set(ancestorIds).has(actor.scopeOrganizationUnitId);
  }

  /** True if the user's ACTIVE assignment is tenant-wide. The userId form is
   * gone: every caller asked "may the actor act tenant-wide", and answering
   * from an inactive Role the user merely holds was the exact bug §4.1
   * closes. */
  async hasTenantScope(actor: ActorContext): Promise<boolean> {
    return actor.assignmentId !== null && actor.scopeType === "tenant";
  }

  /**
   * Used by the Workflow Engine (Checkpoint 0D) to decide whether an actor
   * may act on a Workflow Assignment routed to a Role + Organization Unit
   * "queue" (per 04-Workflow-Approval-Engine-Foundation.md's Assignment
   * concept — a task is routed to whoever holds a role in a scope, not to
   * one pre-picked user).
   *
   * Epic 1 (§4.1 C): the question is now asked about the ACTIVE Role only.
   * Holding Approver in another context must not let the actor decide a task
   * routed to Approver while they are working as Creator — that is precisely
   * the separation-of-duties hole this epic closes.
   *
   * - `targetOrganizationUnitId = null` (a tenant-wide task): the active
   *   assignment must be tenant-wide and carry `roleCode`.
   * - otherwise: the active assignment must be tenant-wide, or scoped to the
   *   target unit itself or one of its ANCESTORS (Checkpoint 0F / ADR-0009).
   */
  async hasActiveRoleCoveringScope(
    actor: ActorContext,
    roleCode: string,
    targetOrganizationUnitId: string | null,
  ): Promise<boolean> {
    if (actor.assignmentId === null || actor.roleCode !== roleCode) return false;
    if (actor.scopeType === "tenant") return true;
    if (targetOrganizationUnitId === null) return false;
    return this.isActiveOrganizationUnitScopeCovered(actor, targetOrganizationUnitId);
  }

  /**
   * Checkpoint 1A / ADR-0011 — Customer Data Scope. Every Customer-context
   * entity (Customer, Contract, Project, Site, Service Assignment, and —
   * per the Checkpoint 1A binding decision — Document/Attachment) resolves
   * authorization through this single method, so it can never drift
   * between call sites (the same design goal as ADR-0009's
   * `listAncestorIds`).
   *
   * Epic 1 (§4.1 C): the enforcement form reads the ACTIVE assignment.
   * Covered if it is ANY of:
   * - tenant-wide (internal Administrator/broad role), OR
   * - an organization_unit assignment covering `ownerOrganizationUnitId`
   *   (internal Supervisor/GM/Regional Manager — hierarchical, ADR-0009),
   *   when the target Customer has an owner Organization Unit, OR
   * - a customer assignment matching `customerId` exactly (a Customer User —
   *   no hierarchy, a Customer has no descendants).
   */
  async requireCustomerContextScopeForActor(
    actor: ActorContext,
    target: { customerId: string; ownerOrganizationUnitId: string | null },
  ): Promise<void> {
    const covered = await this.isActiveCustomerContextScopeCovered(actor, target);
    if (!covered) {
      throw new ForbiddenError("The active Role's Data Scope does not cover this Customer");
    }
  }

  async isActiveCustomerContextScopeCovered(
    actor: ActorContext,
    target: { customerId: string; ownerOrganizationUnitId: string | null },
  ): Promise<boolean> {
    if (actor.assignmentId === null) return false;
    if (actor.scopeType === "tenant") return true;
    if (
      actor.scopeType === "customer" &&
      actor.scopeCustomerId === target.customerId
    ) {
      return true;
    }
    if (
      actor.scopeType === "organization_unit" &&
      target.ownerOrganizationUnitId !== null &&
      actor.scopeOrganizationUnitId !== null
    ) {
      const ancestorIds = await this.orgUnits.listAncestorIds(target.ownerOrganizationUnitId);
      return new Set(ancestorIds).has(actor.scopeOrganizationUnitId);
    }
    return false;
  }

  /** Checkpoint 1B hardening — same rule as `isCustomerContextScopeCovered`,
   * taking a pre-fetched assignment list so a caller filtering a WHOLE
   * LIST of Customers (e.g. `CustomerService.listForTenant`) fetches the
   * actor's assignments exactly once instead of once per row. */
  async isCustomerContextScopeCoveredByAssignments(
    assignments: UserRoleAssignment[],
    target: { customerId: string; ownerOrganizationUnitId: string | null },
  ): Promise<boolean> {
    if (assignments.some((a) => a.scopeType === "tenant")) return true;
    if (
      assignments.some(
        (a) => a.scopeType === "customer" && a.scopeCustomerId === target.customerId,
      )
    ) {
      return true;
    }
    if (target.ownerOrganizationUnitId) {
      const orgUnitAssignments = assignments.filter((a) => a.scopeType === "organization_unit");
      if (orgUnitAssignments.length === 0) return false;
      const ancestorIds = await this.orgUnits.listAncestorIds(target.ownerOrganizationUnitId);
      const ancestorSet = new Set(ancestorIds);
      return orgUnitAssignments.some(
        (a) => a.scopeOrganizationUnitId !== null && ancestorSet.has(a.scopeOrganizationUnitId),
      );
    }
    return false;
  }

  /** Epic 1 — the ACTIVE assignment as a zero-or-one element list, in the
   * shape `isCustomerContextScopeCoveredByAssignments` and friends already
   * accept. Callers that filter a whole LIST by Data Scope (a Customer list,
   * a Project list) swap their source from `getAssignments(userId)` to this
   * and inherit active-Role enforcement without changing their predicate. */
  getActiveAssignment(actor: ActorContext): UserRoleAssignment[] {
    if (
      actor.assignmentId === null ||
      actor.roleId === null ||
      actor.roleCode === null ||
      actor.scopeType === null
    ) {
      return [];
    }
    return [
      {
        id: actor.assignmentId,
        userId: actor.userId,
        roleId: actor.roleId,
        roleCode: actor.roleCode,
        scopeType: actor.scopeType,
        scopeOrganizationUnitId: actor.scopeOrganizationUnitId,
        scopeCustomerId: actor.scopeCustomerId,
      },
    ];
  }

  /** Passthrough — see `RbacRepository.getAssignments`. Kept for callers
   * asking what a user holds in the abstract; enforcement callers use
   * `getActiveAssignment`. */
  async getAssignments(userId: string): Promise<UserRoleAssignment[]> {
    return this.repo.getAssignments(userId);
  }

  /** The caller's own assignments with role/scope display names, for the
   * post-login context picker. Passthrough — see
   * `RbacRepository.getMyAssignmentsWithScopeNames`. */
  async getMyAssignmentsWithScopeNames(userId: string): Promise<MyRoleAssignment[]> {
    return this.repo.getMyAssignmentsWithScopeNames(userId);
  }

  /** The permission codes a single Role grants, used to narrow the caller's
   * own effective set when they pick one context on the selection screen.
   * Read-only metadata about a role the caller already holds — no admin
   * permission required, and it cannot widen authority (the picked role is
   * by definition already among the caller's assignments). */
  async getPermissionsForRole(
    tenantId: string,
    roleCode: string,
  ): Promise<Set<string>> {
    const detail = await this.repo.getRolePermissionDetail(tenantId, roleCode);
    return new Set(detail?.permissions.map((p) => p.code) ?? []);
  }

  /** Returns only assignments where the SAME role grants `permissionCode`.
   * This is the authorization input for Customer-context modules that must not
   * combine a permission carried by one assignment with Data Scope from an
   * unrelated assignment. */
  async getAssignmentsWithPermission(
    userId: string,
    permissionCode: string,
  ): Promise<UserRoleAssignment[]> {
    return this.repo.getAssignmentsWithPermission(userId, permissionCode);
  }
}
