import type { Project, ProjectRepository } from "../../domain/customer/project.entity.js";
import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { CustomerService } from "./customer.service.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";

export interface CreateProjectInput {
  customerId: string;
  contractId?: string | null;
  code: string;
  name: string;
  status?: string;
}

export class ProjectService {
  constructor(
    private readonly repo: ProjectRepository,
    private readonly customers: CustomerService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  async create(actor: ActorContext, input: CreateProjectInput): Promise<Project> {
    await this.rbac.requirePermission(actor.userId, "project.manage");
    await this.customers.getAuthorized(actor, input.customerId);

    const project = await this.repo.create({ ...input, tenantId: actor.tenantId }, actor.userId);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "project.created",
      entityType: "project",
      entityId: project.id,
      metadata: { customerId: input.customerId, code: project.code },
    });

    return project;
  }

  async listByCustomer(actor: ActorContext, customerId: string): Promise<Project[]> {
    await this.rbac.requirePermission(actor.userId, "project.read");
    await this.customers.getAuthorized(actor, customerId);
    return this.repo.listByCustomer(customerId);
  }
}
