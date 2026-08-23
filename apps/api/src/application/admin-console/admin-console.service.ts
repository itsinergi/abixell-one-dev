import type { AuditService } from "../audit/audit.service.js";
import type { ConfigurationService } from "../configuration/configuration.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { WorkflowService } from "../workflow/workflow.service.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import type { Permission, RbacRepository, RoleSummary } from "../../domain/rbac/rbac.entity.js";
import type { UserRepository } from "../../domain/identity/user.entity.js";

/**
 * Phase 11C — Business Admin Console Foundation.
 *
 * A tenant-local, strictly READ-ONLY consolidation surface for business
 * (tenant) administrators. It is NOT the Platform Architect / Builder
 * Console: it introduces no metadata authoring, no schema mutation, no
 * manifest runtime, no package installation, and no query editor. It
 * composes data that existing services already expose, for the actor's own
 * tenant only.
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
  /** Phase 11C is read-only by construction; declared so the UI never
   * renders a control the backend would refuse. */
  capabilities: {
    readOnly: true;
    userManage: false;
    roleManage: false;
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
  private async requireConsoleAccess(actor: ActorContext): Promise<Set<string>> {
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
      return { access: { visible: false, requiredPermission: permission }, value: null };
    }
    return { access: { visible: true, requiredPermission: permission }, value: await read() };
  }

  async getOverview(actor: ActorContext): Promise<AdminOverview> {
    const held = await this.requireConsoleAccess(actor);

    const [users, roles, permissions, modules, workflows, auditEntries] = await Promise.all([
      this.section(held, "user.read", () => this.userRepo.listByTenant(actor.tenantId)),
      this.section(held, "config.read", () => this.rbacRepo.listRoleSummaries(actor.tenantId)),
      this.section(held, "config.read", () => this.rbacRepo.listPermissionCatalog()),
      this.section(held, "config.read", () => this.configuration.listModuleActivations(actor)),
      this.section(held, "workflow.definition.read", () => this.workflow.listDefinitions(actor)),
      this.section(held, "audit_log.read", () =>
        this.audit.listRecentByTenant(actor.tenantId, RECENT_AUDIT_LIMIT),
      ),
    ]);

    return {
      tenantId: actor.tenantId,
      sections: {
        users: { ...users.access, count: users.value?.length ?? null },
        roles: { ...roles.access, count: roles.value?.length ?? null },
        permissions: { ...permissions.access, count: permissions.value?.length ?? null },
        modules: {
          ...modules.access,
          count: modules.value?.length ?? null,
          activeCount: modules.value ? modules.value.filter((m) => m.isActive).length : null,
        },
        workflows: { ...workflows.access, count: workflows.value?.length ?? null },
        audit: { ...auditEntries.access, count: auditEntries.value?.length ?? null },
      },
      capabilities: {
        readOnly: true,
        userManage: false,
        roleManage: false,
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

  async listWorkflows(actor: ActorContext): Promise<AdminWorkflowSummaryView[]> {
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
    const entries = await this.audit.listRecentByTenant(actor.tenantId, RECENT_AUDIT_LIMIT);
    return entries.map((entry) => ({
      id: entry.id,
      action: entry.action,
      entityType: entry.entityType,
      actorUserId: entry.actorUserId,
      createdAt: entry.createdAt,
    }));
  }
}
