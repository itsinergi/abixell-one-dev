import type {
  CreateTenantInput,
  TenantRepository,
  UpdateTenantInput,
} from "../../domain/tenant/tenant.entity.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import { ConflictError, NotFoundError } from "../../domain/shared-kernel/errors.js";
import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";

/**
 * Tenant creation is a platform-bootstrap operation, not an RBAC-guarded
 * one: per Founder Decision 1 (Dedicated Deployment per Client) a
 * deployment is provisioned with exactly one Tenant before any User or
 * Role exists in it, so there is nothing for RBAC to check yet. The HTTP
 * layer protects this endpoint with a platform bootstrap key instead
 * (see interfaces/http/plugins/bootstrap-auth.ts and ADR-0004).
 */
export class TenantService {
  constructor(
    private readonly repo: TenantRepository,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  async create(input: CreateTenantInput): Promise<ReturnType<TenantRepository["create"]>> {
    const existing = await this.repo.findByCode(input.code);
    if (existing) {
      throw new ConflictError(`Tenant code '${input.code}' already exists`);
    }
    const tenant = await this.repo.create(input, null);
    await this.audit.record({
      tenantId: tenant.id,
      actorUserId: null,
      action: "tenant.created",
      entityType: "tenant",
      entityId: tenant.id,
      metadata: { code: tenant.code, name: tenant.name },
    });
    return tenant;
  }

  async getById(id: string) {
    const tenant = await this.repo.findById(id);
    if (!tenant) throw new NotFoundError("Tenant", id);
    return tenant;
  }

  async updateName(actor: ActorContext, input: UpdateTenantInput) {
    await this.rbac.requireTenantScopedPermissionForActor(actor, "tenant.update");
    return this.repo.updateName(input, actor);
  }

  list() {
    return this.repo.list();
  }
}
