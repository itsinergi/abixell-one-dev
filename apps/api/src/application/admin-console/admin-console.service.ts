import type { AuditService } from "../audit/audit.service.js";
import type { ConfigurationService } from "../configuration/configuration.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { WorkflowService } from "../workflow/workflow.service.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import type {
  AdminAssignmentRow,
  AdminRoleAssignmentSummary,
  AdminUserAccessSummary,
  AssignmentBatchResult,
  AssignmentOptions,
  CopyRoleDefinitionInput,
  CreateGovernedUserInput,
  CreateRoleDefinitionInput,
  GovernedRoleAssignmentInput,
  GovernedUserSummary,
  Permission,
  PreviewRoleAssignmentsInput,
  RbacRepository,
  RoleDefinition,
  RoleDefinitionOptions,
  RoleDefinitionPreviewInput,
  RoleDefinitionPreview,
  RolePermissionDetail,
  RoleSummary,
  UpdateRoleAssignmentsInput,
  UpdateRoleDefinitionInput,
} from "../../domain/rbac/rbac.entity.js";
import type {
  AdministrativeVisibility,
  AssignmentBatchPreview,
} from "../../domain/rbac/visibility-scope.js";
import type { UserRepository } from "../../domain/identity/user.entity.js";
import { ForbiddenError, NotFoundError } from "../../domain/shared-kernel/errors.js";

/**
 * Phase 11C Business Admin Console foundation, extended in Phase 11F by a
 * bounded governed User Role assignment slice.
 *
 * The console remains tenant-local and is NOT the Platform Architect / Builder
 * Console: it introduces no metadata authoring, schema mutation, manifest
 * runtime, package installation, query editor, or generic role/permission
 * editor. Phase 11F permits only assigning/removing existing tenant Roles with
 * an explicit Data Scope, under transactional authorization and audit.
 *
 * Authorization model — two independent axes, both enforced:
 *
 *  1. `admin.console.read` gates ENTRY to the console. It is an
 *     entry ticket, never an override: holding it alone reveals no
 *     administrative record.
 *  2. Every section is additionally gated by the SAME permission that
 *     already governs that data elsewhere (`user.read`, `config.read`,
 *     `workflow.definition.read`, `audit_log.read`). A section the actor
 *     cannot see is reported as `visible: false` and carries no data.
 *
 * This ordering matters: a viewer who somehow obtains `admin.console.read`
 * gains no data they could not already read through the existing per-area
 * endpoints. The console can therefore never become a privilege-escalation
 * shortcut or a de-facto superuser surface.
 */

/** The permission that gates entry to the console. */
export const ADMIN_CONSOLE_READ = "admin.console.read";
export const ROLE_MANAGE = "role.manage";

/** A console section the actor may or may not be permitted to see. */
export interface AdminSectionAccess {
  /** Whether the actor holds the permission backing this section. */
  visible: boolean;
  /** The permission code enforced — surfaced so the UI explains denials. */
  requiredPermission: string;
}

export interface AdminCountSection extends AdminSectionAccess {
  /** Null when `visible` is false — never a misleading zero. */
  count: number | null;
}

export interface AdminOverview {
  tenantId: string;
  sections: {
    users: AdminCountSection;
    roles: AdminCountSection;
    permissions: AdminCountSection;
    modules: AdminCountSection & { activeCount: number | null };
    workflows: AdminCountSection;
    audit: AdminCountSection;
  };
  capabilities: {
    /** Phase 11F enables only governed User Role assignment management. */
    readOnly: boolean;
    userRoleManage: boolean;
    /** Read prerequisites surfaced separately so the Web editor never implies
     * that mutation authority alone can load its mandatory review context. */
    userAccessRead: boolean;
    rolePermissionRead: boolean;
    userManage: false;
    /** Epic 4 Wave 1: role-definition management authority (`role.manage`),
     * tenant-scoped. Derived — never a hardcoded false. */
    roleManage: boolean;
    permissionManage: false;
    moduleActivationManage: false;
    workflowManage: false;
  };
}

export interface AdminRoleSummaryView {
  code: string;
  name: string;
  isFullAccess: boolean;
  permissionCount: number;
  assignedUserCount: number;
}

export interface AdminModuleSummaryView {
  moduleCode: string;
  moduleName: string;
  isActive: boolean;
}

export interface AdminWorkflowSummaryView {
  code: string;
  name: string;
  entityType: string;
  isActive: boolean;
}

/**
 * A privacy-safe projection of an audit entry. `metadata` is deliberately
 * NOT projected: it is free-form and may carry business narrative or
 * reason text. `entityId` is likewise omitted — the console shows THAT an
 * action occurred, not which record it touched.
 */
export interface AdminAuditEntryView {
  id: string;
  action: string;
  entityType: string;
  actorUserId: string | null;
  createdAt: Date;
}

/** Bounded so the console can never become a bulk audit export. */
const RECENT_AUDIT_LIMIT = 25;

export class AdminConsoleService {
  constructor(
    private readonly rbac: RbacService,
    private readonly rbacRepo: RbacRepository,
    private readonly userRepo: UserRepository,
    private readonly configuration: ConfigurationService,
    private readonly workflow: WorkflowService,
    private readonly audit: AuditService,
  ) {}

  /** Entry gate. Every public method calls this FIRST. */
  private async requireConsoleAccess(
    actor: ActorContext,
  ): Promise<Set<string>> {
    await this.rbac.requirePermission(actor.userId, ADMIN_CONSOLE_READ);
    return this.rbac.getEffectivePermissions(actor.userId);
  }

  /**
   * Section gate. Returns the actor's data only when they independently
   * hold `permission`; otherwise the section is reported invisible and the
   * underlying read is never issued.
   */
  private async section<T>(
    held: Set<string>,
    permission: string,
    read: () => Promise<T>,
  ): Promise<{ access: AdminSectionAccess; value: T | null }> {
    const visible = held.has(permission);
    if (!visible) {
      return {
        access: { visible: false, requiredPermission: permission },
        value: null,
      };
    }
    return {
      access: { visible: true, requiredPermission: permission },
      value: await read(),
    };
  }

  async getOverview(actor: ActorContext): Promise<AdminOverview> {
    const held = await this.requireConsoleAccess(actor);
    const [userRoleManage, userAccessRead, rolePermissionRead, roleManage] =
      await Promise.all([
        this.rbacRepo.hasTenantScopedPermission(
          actor.tenantId,
          actor.userId,
          "user.role.manage",
        ),
        this.rbacRepo.hasTenantScopedPermission(
          actor.tenantId,
          actor.userId,
          "user.read",
        ),
        this.rbacRepo.hasTenantScopedPermission(
          actor.tenantId,
          actor.userId,
          "config.read",
        ),
        this.rbacRepo.hasTenantScopedPermission(
          actor.tenantId,
          actor.userId,
          ROLE_MANAGE,
        ),
      ]);

    const [users, roles, permissions, modules, workflows, auditEntries] =
      await Promise.all([
        this.section(held, "user.read", () =>
          this.userRepo.listByTenant(actor.tenantId),
        ),
        this.section(held, "config.read", () =>
          this.rbacRepo.listRoleSummaries(actor.tenantId),
        ),
        this.section(held, "config.read", () =>
          this.rbacRepo.listPermissionCatalog(),
        ),
        this.section(held, "config.read", () =>
          this.configuration.listModuleActivations(actor),
        ),
        this.section(held, "workflow.definition.read", () =>
          this.workflow.listDefinitions(actor),
        ),
        this.section(held, "audit_log.read", () =>
          this.audit.listRecentByTenant(actor.tenantId, RECENT_AUDIT_LIMIT),
        ),
      ]);

    return {
      tenantId: actor.tenantId,
      sections: {
        users: { ...users.access, count: users.value?.length ?? null },
        roles: { ...roles.access, count: roles.value?.length ?? null },
        permissions: {
          ...permissions.access,
          count: permissions.value?.length ?? null,
        },
        modules: {
          ...modules.access,
          count: modules.value?.length ?? null,
          activeCount: modules.value
            ? modules.value.filter((m) => m.isActive).length
            : null,
        },
        workflows: {
          ...workflows.access,
          count: workflows.value?.length ?? null,
        },
        audit: {
          ...auditEntries.access,
          count: auditEntries.value?.length ?? null,
        },
      },
      capabilities: {
        readOnly: !userRoleManage,
        userRoleManage,
        userAccessRead,
        rolePermissionRead,
        userManage: false,
        roleManage,
        permissionManage: false,
        moduleActivationManage: false,
        workflowManage: false,
      },
    };
  }

  async listRoles(actor: ActorContext): Promise<AdminRoleSummaryView[]> {
    await this.requireConsoleAccess(actor);
    await this.rbac.requirePermission(actor.userId, "config.read");
    const roles = await this.rbacRepo.listRoleSummaries(actor.tenantId);
    // `id` is intentionally dropped: the console identifies a Role by its
    // stable business code, and never hands out a mutation handle.
    return roles.map((role: RoleSummary) => ({
      code: role.code,
      name: role.name,
      isFullAccess: role.isFullAccess,
      permissionCount: role.permissionCount,
      assignedUserCount: role.assignedUserCount,
    }));
  }

  /**
   * The global permission catalog. `permissions` is a migration-owned global
   * table with no `tenant_id` — it is byte-identical in every deployment, so
   * exposing code+description leaks no tenant data. It is the definitive
   * answer to "what can be granted here", which an administrator needs.
   */
  async listPermissions(actor: ActorContext): Promise<Permission[]> {
    await this.requireConsoleAccess(actor);
    await this.rbac.requirePermission(actor.userId, "config.read");
    return this.rbacRepo.listPermissionCatalog();
  }

  async listModules(actor: ActorContext): Promise<AdminModuleSummaryView[]> {
    await this.requireConsoleAccess(actor);
    // `listModuleActivations` enforces `config.read` itself — the owning
    // service stays the single authority for its own data.
    const modules = await this.configuration.listModuleActivations(actor);
    return modules.map((module) => ({
      moduleCode: module.moduleCode,
      moduleName: module.moduleName,
      isActive: module.isActive,
    }));
  }

  async listWorkflows(
    actor: ActorContext,
  ): Promise<AdminWorkflowSummaryView[]> {
    await this.requireConsoleAccess(actor);
    // `listDefinitions` enforces `workflow.definition.read` itself.
    const definitions = await this.workflow.listDefinitions(actor);
    return definitions.map((definition) => ({
      code: definition.code,
      name: definition.name,
      entityType: definition.entityType,
      isActive: definition.isActive,
    }));
  }

  async listRecentAudit(actor: ActorContext): Promise<AdminAuditEntryView[]> {
    await this.requireConsoleAccess(actor);
    await this.rbac.requirePermission(actor.userId, "audit_log.read");
    const entries = await this.audit.listRecentByTenant(
      actor.tenantId,
      RECENT_AUDIT_LIMIT,
    );
    return entries.map((entry) => ({
      id: entry.id,
      action: entry.action,
      entityType: entry.entityType,
      actorUserId: entry.actorUserId,
      createdAt: entry.createdAt,
    }));
  }

  /**
   * Epic 4 Wave 2 (§4.4 D) — every access surface answers to the SAME
   * visibility + delegation policy. The service resolves the actor's
   * administrative visibility server-side from their OWN permission-bearing
   * assignments and hands it to the repository, whose SQL narrows the target
   * list (§4.4 step 16). An empty `units` visibility is a refusal, not an
   * empty page: an actor without `user.read` must not read "there are no
   * Users here" when the truth is "you may not ask".
   */
  private async requireUserReadVisibility(
    actor: ActorContext,
  ): Promise<AdministrativeVisibility> {
    await this.requireConsoleAccess(actor);
    const visibility = await this.rbacRepo.resolveAdministrativeVisibility(
      actor.tenantId,
      actor.userId,
      "user.read",
    );
    if (visibility.kind === "units" && visibility.organizationUnitIds.length === 0) {
      throw new ForbiddenError("Missing permission or Data Scope for 'user.read'");
    }
    return visibility;
  }

  async listUserAccess(actor: ActorContext): Promise<AdminUserAccessSummary[]> {
    const visibility = await this.requireUserReadVisibility(actor);
    return this.rbacRepo.listAdminUserAccess(actor.tenantId, visibility);
  }

  async getUserAccess(
    actor: ActorContext,
    targetUserId: string,
  ): Promise<AdminUserAccessSummary> {
    const visibility = await this.requireUserReadVisibility(actor);
    const access = await this.rbacRepo.getAdminUserAccess(
      actor.tenantId,
      targetUserId,
      visibility,
    );
    // Out of visibility is indistinguishable from missing (§4.4 risk row 1).
    if (!access) throw new NotFoundError("User", targetUserId);
    return access;
  }

  async listAdminAssignments(
    actor: ActorContext,
  ): Promise<AdminAssignmentRow[]> {
    await this.requireConsoleAccess(actor);
    // Step 13's rows describe grants, so the actor needs the same mutation
    // authority that governs them: a viewer who cannot assign must not read
    // the grant inventory either.
    const visibility = await this.rbacRepo.resolveAdministrativeVisibility(
      actor.tenantId,
      actor.userId,
      "user.role.manage",
    );
    if (visibility.kind === "units" && visibility.organizationUnitIds.length === 0) {
      throw new ForbiddenError(
        "Missing permission or Data Scope for 'user.role.manage'",
      );
    }
    return this.rbacRepo.listAdminAssignments(actor.tenantId, visibility);
  }

  async assignmentOptions(actor: ActorContext): Promise<AssignmentOptions> {
    await this.requireConsoleAccess(actor);
    return this.rbacRepo.listAssignmentOptions(actor);
  }

  async previewUserAssignments(
    actor: ActorContext,
    targetUserId: string,
    input: PreviewRoleAssignmentsInput,
  ): Promise<AssignmentBatchPreview> {
    await this.requireConsoleAccess(actor);
    return this.rbacRepo.previewRoleAssignments(actor, targetUserId, input);
  }

  async confirmUserAssignments(
    actor: ActorContext,
    targetUserId: string,
    input: UpdateRoleAssignmentsInput,
  ): Promise<AssignmentBatchResult> {
    await this.requireConsoleAccess(actor);
    return this.rbacRepo.updateRoleAssignments(actor, targetUserId, input);
  }

  async createUserWithAssignments(
    actor: ActorContext,
    input: CreateGovernedUserInput,
  ): Promise<{ user: GovernedUserSummary; assignments: AdminRoleAssignmentSummary[] }> {
    await this.requireConsoleAccess(actor);
    return this.rbacRepo.createGovernedUserWithAssignments(actor, input);
  }

  async getRolePermissions(
    actor: ActorContext,
    roleCode: string,
  ): Promise<RolePermissionDetail> {
    await this.requireConsoleAccess(actor);
    await this.rbac.requireTenantScopedPermission(
      actor.tenantId,
      actor.userId,
      "config.read",
    );
    const role = await this.rbacRepo.getRolePermissionDetail(
      actor.tenantId,
      roleCode,
    );
    if (!role) throw new NotFoundError("Role", roleCode);
    return role;
  }

  /**
   * Epic 4 Wave 2 §4.4 D — both Phase 11F writes answer to the Wave 2
   * visibility + delegation policy, so the tenant-scoped pre-check that used to
   * stand here is deliberately gone. It would have refused a narrow
   * Organization-Unit administrator with 403 before the repository could
   * resolve their visibility, which is the very aggregation rule the policy
   * exists to express: the repository refuses by TARGET (404), not by gate, and
   * it revalidates the whole authority chain inside the tenant-locked
   * transaction. These service-level gates are convenience only and are never
   * the security boundary.
   */
  async assignUserRole(
    actor: ActorContext,
    targetUserId: string,
    input: GovernedRoleAssignmentInput,
  ): Promise<AdminRoleAssignmentSummary> {
    await this.requireConsoleAccess(actor);
    return this.rbacRepo.createGovernedRoleAssignment(
      actor,
      targetUserId,
      input,
    );
  }

  /** Epic 4 Wave 3 step 18 — revoke, not remove. The assignment row and its
   * history are retained; the grant stops authorizing on the next check. */
  async revokeUserRole(
    actor: ActorContext,
    targetUserId: string,
    assignmentId: string,
    reason: string,
  ): Promise<void> {
    await this.requireConsoleAccess(actor);
    await this.rbacRepo.revokeGovernedRoleAssignment(
      actor,
      targetUserId,
      assignmentId,
      reason,
    );
  }

  // ========================================================================
  // Epic 4 Wave 1 — Role definition (§4.4 Gelombang 1). HTTP pre-checks are
  // convenience only: the repository revalidates the full authority chain
  // (active actor, `admin.console.read`, ONE tenant-scoped assignment with
  // `role.manage` + `config.read`) inside the tenant-locked transaction, so
  // these service-level gates are never the security boundary.
  // ========================================================================

  async getRoleDefinition(
    actor: ActorContext,
    roleCode: string,
  ): Promise<RoleDefinition> {
    await this.requireConsoleAccess(actor);
    await this.rbac.requireTenantScopedPermission(
      actor.tenantId,
      actor.userId,
      "config.read",
    );
    const definition = await this.rbacRepo.getRoleDefinition(
      actor.tenantId,
      roleCode,
    );
    if (!definition) throw new NotFoundError("Role", roleCode);
    return definition;
  }

  async listRoleDefinitionOptions(
    actor: ActorContext,
  ): Promise<RoleDefinitionOptions> {
    await this.requireConsoleAccess(actor);
    await this.rbac.requireTenantScopedPermission(
      actor.tenantId,
      actor.userId,
      "config.read",
    );
    return this.rbacRepo.listRoleDefinitionOptions(actor);
  }

  async createRoleDefinition(
    actor: ActorContext,
    input: CreateRoleDefinitionInput,
  ): Promise<RoleDefinition> {
    await this.requireConsoleAccess(actor);
    await this.rbac.requireTenantScopedPermission(
      actor.tenantId,
      actor.userId,
      ROLE_MANAGE,
    );
    return this.rbacRepo.createRoleDefinition(actor, input);
  }

  async copyRoleDefinition(
    actor: ActorContext,
    sourceCode: string,
    input: CopyRoleDefinitionInput,
  ): Promise<RoleDefinition> {
    await this.requireConsoleAccess(actor);
    await this.rbac.requireTenantScopedPermission(
      actor.tenantId,
      actor.userId,
      ROLE_MANAGE,
    );
    return this.rbacRepo.copyRoleDefinition(actor, sourceCode, input);
  }

  async previewRoleDefinition(
    actor: ActorContext,
    roleCode: string,
    input: RoleDefinitionPreviewInput,
  ): Promise<RoleDefinitionPreview> {
    await this.requireConsoleAccess(actor);
    await this.rbac.requireTenantScopedPermission(
      actor.tenantId,
      actor.userId,
      "config.read",
    );
    return this.rbacRepo.previewRoleDefinition(actor, roleCode, input);
  }

  async updateRoleDefinition(
    actor: ActorContext,
    roleCode: string,
    input: UpdateRoleDefinitionInput,
  ): Promise<RoleDefinition> {
    await this.requireConsoleAccess(actor);
    await this.rbac.requireTenantScopedPermission(
      actor.tenantId,
      actor.userId,
      ROLE_MANAGE,
    );
    return this.rbacRepo.updateRoleDefinition(actor, roleCode, input);
  }

  async deleteRoleDefinition(
    actor: ActorContext,
    roleCode: string,
  ): Promise<void> {
    await this.requireConsoleAccess(actor);
    await this.rbac.requireTenantScopedPermission(
      actor.tenantId,
      actor.userId,
      ROLE_MANAGE,
    );
    await this.rbacRepo.deleteRoleDefinition(actor, roleCode);
  }

  /** Epic 4 open item 2 — deactivate/activate. Gated exactly like the other
   * Role-definition writes: this changes whether the Role authorizes, so it
   * needs the same authority as editing its permission set. The live-assignment
   * guard for deactivation lives in the repository, inside the tenant lock. */
  async setRoleDefinitionActive(
    actor: ActorContext,
    roleCode: string,
    isActive: boolean,
  ): Promise<RoleDefinition> {
    await this.requireConsoleAccess(actor);
    await this.rbac.requireTenantScopedPermission(
      actor.tenantId,
      actor.userId,
      ROLE_MANAGE,
    );
    return this.rbacRepo.setRoleDefinitionActive(actor, roleCode, isActive);
  }
}
