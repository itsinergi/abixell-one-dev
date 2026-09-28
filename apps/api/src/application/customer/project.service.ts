import type { Project, ProjectRepository, UpdateProjectInput } from "../../domain/customer/project.entity.js";
import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { CustomerService } from "./customer.service.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import { NotFoundError } from "../../domain/shared-kernel/errors.js";

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
    await this.rbac.requirePermission(actor, "project.manage");
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

  async update(actor: ActorContext, id: string, input: UpdateProjectInput): Promise<Project> {
    await this.rbac.requirePermission(actor, "project.manage");
    const current = await this.repo.findById(id);
    if (!current || current.tenantId !== actor.tenantId) {
      throw new NotFoundError("Project", id);
    }
    await this.customers.getAuthorized(actor, current.customerId);

    const project = await this.repo.update(current.id, input, actor.userId);
    if (!project) throw new NotFoundError("Project", id);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "project.updated",
      entityType: "project",
      entityId: project.id,
      metadata: { customerId: project.customerId, code: project.code, status: project.status },
    });

    return project;
  }

  async listByCustomer(actor: ActorContext, customerId: string): Promise<Project[]> {
    await this.rbac.requirePermission(actor, "project.read");
    await this.customers.getAuthorized(actor, customerId);
    return this.repo.listByCustomer(customerId);
  }
}
