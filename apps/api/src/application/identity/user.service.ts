import type { UserRepository } from "../../domain/identity/user.entity.js";
import type { RbacRepository } from "../../domain/rbac/rbac.entity.js";
import type { CustomerRepository } from "../../domain/customer/customer.entity.js";
import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../domain/shared-kernel/errors.js";
import { hashPassword } from "../../infrastructure/security/password.js";

export interface CreateUserWithRoleInput {
  email: string;
  fullName: string;
  password: string;
  roleCode: string;
  scopeType: "tenant" | "organization_unit" | "customer";
  scopeOrganizationUnitId?: string | null;
  /** Checkpoint 1A / ADR-0011 — required when scopeType === "customer". */
  scopeCustomerId?: string | null;
}

export class UserService {
  constructor(
    private readonly repo: UserRepository,
    private readonly rbacRepo: RbacRepository,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    /** Checkpoint 1A — used only to resolve a Customer's owner
     * Organization Unit when creating a Customer User (scopeType
     * 'customer'); optional so existing tests/callers that never create a
     * Customer User do not need to wire it. */
    private readonly customerRepo?: CustomerRepository,
  ) {}

  async createWithRole(actor: ActorContext, input: CreateUserWithRoleInput) {
    await this.rbac.requirePermission(actor.userId, "user.create");

    const existing = await this.repo.findByEmailInTenant(actor.tenantId, input.email);
    if (existing) {
      throw new ConflictError(`Email '${input.email}' already exists in this Tenant`);
    }

    const role = await this.rbacRepo.findRoleByCode(actor.tenantId, input.roleCode);
    if (!role) throw new NotFoundError("Role", input.roleCode);

    // Granting scope wider than or equal to what the actor themself holds
    // is not allowed: an org-unit-scoped Supervisor cannot mint a
    // tenant-wide Administrator. This is enforced here, in the backend,
    // regardless of what the frontend does or doesn't show.
    if (input.scopeType === "tenant") {
      const actorHasTenantScope = await this.rbac.hasTenantScope(actor.userId);
      if (!actorHasTenantScope) {
        throw new ForbiddenError(
          "Cannot grant tenant-wide Data Scope without holding it yourself",
        );
      }
    } else if (input.scopeType === "organization_unit" && input.scopeOrganizationUnitId) {
      await this.rbac.requireOrganizationUnitScope(actor.userId, input.scopeOrganizationUnitId);
    } else if (input.scopeType === "customer") {
      // Checkpoint 1A: the actor creating a Customer User must themself
      // be authorized against that Customer (same "cannot grant wider
      // than you hold" principle as the tenant-scope check above) — a
      // Supervisor scoped only to Customer A cannot create a Customer
      // User for Customer B.
      if (!input.scopeCustomerId) {
        throw new ForbiddenError("scopeCustomerId is required when scopeType is 'customer'");
      }
      const customer = await this.customerRepo?.findById(input.scopeCustomerId);
      if (!customer || customer.tenantId !== actor.tenantId) {
        throw new NotFoundError("Customer", input.scopeCustomerId);
      }
      await this.rbac.requireCustomerContextScope(actor.userId, {
        customerId: input.scopeCustomerId,
        ownerOrganizationUnitId: customer.ownerOrganizationUnitId,
      });
    }

    const passwordHash = await hashPassword(input.password);
    const user = await this.repo.create(
      { tenantId: actor.tenantId, email: input.email, fullName: input.fullName, passwordHash },
      actor.userId,
    );

    const assignment = await this.rbacRepo.assignRole(
      {
        userId: user.id,
        roleId: role.id,
        scopeType: input.scopeType,
        scopeOrganizationUnitId: input.scopeOrganizationUnitId ?? null,
        scopeCustomerId: input.scopeCustomerId ?? null,
      },
      actor.userId,
    );

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "user.created",
      entityType: "user",
      entityId: user.id,
      metadata: { email: user.email, roleCode: role.code, scopeType: input.scopeType },
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "user.role_assigned",
      entityType: "user",
      entityId: user.id,
      metadata: { roleCode: role.code, scopeType: input.scopeType },
    });

    return { user, assignment };
  }

  async listForTenant(actor: ActorContext) {
    await this.rbac.requirePermission(actor.userId, "user.read");
    return this.repo.listByTenant(actor.tenantId);
  }
}
