import type {
  CustomerServiceLink,
  CustomerServiceLinkRepository,
  Service,
  ServiceRepository,
  UpdateCustomerServiceLinkInput,
  UpdateServiceInput,
} from "../../domain/customer/service.entity.js";
import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { CustomerService as CustomerContextService } from "./customer.service.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import { NotFoundError } from "../../domain/shared-kernel/errors.js";

export interface CreateServiceCatalogInput {
  code: string;
  name: string;
  description?: string | null;
}

export interface CreateServiceAssignmentInput {
  customerId: string;
  serviceId: string;
  contractId?: string | null;
  projectId?: string | null;
  siteId?: string | null;
  internalPicUserId?: string | null;
}

/**
 * Service catalog (Tenant-level, e.g. dummy "Catering"/"Housekeeping"
 * entries a real Tenant would configure — see migration header) + Service
 * Assignment, the "Service Assigned" step of the 1A E2E target. The
 * catalog itself is Tenant-permission-gated only (it is reference data,
 * not Customer data); assigning a Service TO a Customer goes through the
 * same Customer Data Scope choke point as Contract/Project/Site.
 */
export class ServiceCatalogService {
  constructor(
    private readonly serviceRepo: ServiceRepository,
    private readonly linkRepo: CustomerServiceLinkRepository,
    private readonly customers: CustomerContextService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  async createService(actor: ActorContext, input: CreateServiceCatalogInput): Promise<Service> {
    await this.rbac.requirePermission(actor, "service.manage");
    const service = await this.serviceRepo.create({ ...input, tenantId: actor.tenantId }, actor.userId);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "service.created",
      entityType: "service",
      entityId: service.id,
      metadata: { code: service.code, name: service.name },
    });

    return service;
  }

  async listServices(actor: ActorContext): Promise<Service[]> {
    await this.rbac.requirePermission(actor, "service.read");
    return this.serviceRepo.listByTenant(actor.tenantId);
  }

  async updateService(actor: ActorContext, id: string, input: UpdateServiceInput): Promise<Service> {
    await this.rbac.requirePermission(actor, "service.manage");
    const current = await this.serviceRepo.findById(id);
    if (!current || current.tenantId !== actor.tenantId) {
      throw new NotFoundError("Service", id);
    }

    const service = await this.serviceRepo.update(current.id, input, actor.userId);
    if (!service) throw new NotFoundError("Service", id);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "service.updated",
      entityType: "service",
      entityId: service.id,
      metadata: { code: service.code, name: service.name, isActive: service.isActive },
    });

    return service;
  }

  async assignToCustomer(
    actor: ActorContext,
    input: CreateServiceAssignmentInput,
  ): Promise<CustomerServiceLink> {
    await this.rbac.requirePermission(actor, "service.manage");
    await this.customers.getAuthorized(actor, input.customerId);

    const link = await this.linkRepo.create({ ...input, tenantId: actor.tenantId }, actor.userId);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "customer.service_assigned",
      entityType: "customer_service_link",
      entityId: link.id,
      metadata: { customerId: input.customerId, serviceId: input.serviceId },
    });

    return link;
  }

  async updateAssignment(
    actor: ActorContext,
    id: string,
    input: UpdateCustomerServiceLinkInput,
  ): Promise<CustomerServiceLink> {
    await this.rbac.requirePermission(actor, "service.manage");
    const current = await this.linkRepo.findById(id);
    if (!current || current.tenantId !== actor.tenantId) {
      throw new NotFoundError("CustomerServiceLink", id);
    }
    await this.customers.getAuthorized(actor, current.customerId);

    if (input.serviceId) {
      const service = await this.serviceRepo.findById(input.serviceId);
      if (!service || service.tenantId !== actor.tenantId) {
        throw new NotFoundError("Service", input.serviceId);
      }
    }

    const link = await this.linkRepo.update(current.id, input, actor.userId);
    if (!link) throw new NotFoundError("CustomerServiceLink", id);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "customer.service_assignment_updated",
      entityType: "customer_service_link",
      entityId: link.id,
      metadata: { customerId: link.customerId, serviceId: link.serviceId, status: link.status },
    });

    return link;
  }

  async listAssignmentsForCustomer(
    actor: ActorContext,
    customerId: string,
  ): Promise<CustomerServiceLink[]> {
    await this.rbac.requirePermission(actor, "service.read");
    await this.customers.getAuthorized(actor, customerId);
    return this.linkRepo.listByCustomer(customerId);
  }
}
