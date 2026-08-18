import type {
  Customer,
  CustomerContactRepository,
  CustomerRepository,
} from "../../domain/customer/customer.entity.js";
import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import { NotFoundError } from "../../domain/shared-kernel/errors.js";

export interface CreateCustomerInput {
  code: string;
  name: string;
  status?: string;
  ownerOrganizationUnitId?: string | null;
  notes?: string | null;
}

export interface CreateCustomerContactInput {
  customerId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  isPrimary?: boolean;
}

/**
 * Customer Foundation (Checkpoint 1A). Also the reference implementation
 * every other Customer-context service (Contract/Project/Site/Service
 * Assignment) and the Document Service's `customer` Entity Authorization
 * Resolver (ADR-0012) delegate to for "can this actor touch data
 * belonging to this Customer" — kept in one place so the answer can never
 * drift between call sites (ADR-0011).
 */
export class CustomerService {
  constructor(
    private readonly repo: CustomerRepository,
    private readonly contactRepo: CustomerContactRepository,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  async create(actor: ActorContext, input: CreateCustomerInput): Promise<Customer> {
    await this.rbac.requirePermission(actor.userId, "customer.manage");
    if (input.ownerOrganizationUnitId) {
      await this.rbac.requireOrganizationUnitScope(actor.userId, input.ownerOrganizationUnitId);
    }

    const customer = await this.repo.create(
      { ...input, tenantId: actor.tenantId },
      actor.userId,
    );

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "customer.created",
      entityType: "customer",
      entityId: customer.id,
      metadata: { code: customer.code, name: customer.name },
    });

    return customer;
  }

  async listForTenant(actor: ActorContext): Promise<Customer[]> {
    await this.rbac.requirePermission(actor.userId, "customer.read");
    // Checkpoint 1A: listing is Tenant-wide-permission-gated only, mirroring
    // 0B's `OrganizationUnitService.listForTenant`/`legalEntity.listForTenant`
    // precedent — a user holding `customer.read` sees every Customer in
    // their Tenant, same posture as those Phase 0 listings. Per-Customer
    // Data Scope is enforced on the SINGLE-entity path (`getAuthorized`,
    // used by Contract/Project/Site/Service/Document access), which is
    // the path a Customer User (scoped to exactly one Customer) actually
    // exercises. A Customer User does not hold `customer.read` widely
    // enough to hit this listing endpoint in practice; narrowing this
    // listing to the actor's Data Scope is tracked as a natural follow-up
    // once a curated "Customer Portal" role needs it (1C).
    return this.repo.listByTenant(actor.tenantId);
  }

  /** Loads a Customer and enforces both Tenant isolation and Data Scope.
   * The single choke point every Customer-context module (Contract,
   * Project, Site, Service Assignment, Document resolver) calls through. */
  async getAuthorized(actor: ActorContext, customerId: string): Promise<Customer> {
    const customer = await this.repo.findById(customerId);
    if (!customer || customer.tenantId !== actor.tenantId) {
      throw new NotFoundError("Customer", customerId);
    }
    await this.rbac.requireCustomerContextScope(actor.userId, {
      customerId: customer.id,
      ownerOrganizationUnitId: customer.ownerOrganizationUnitId,
    });
    return customer;
  }

  /**
   * Checkpoint 1A binding decision (Document Scope): "Attachment mengikuti
   * authorization dan Data Scope dari parent entity ... tidak memiliki
   * independent business authorization yang terpisah". Used by the
   * Document Service's `customer` Entity Authorization Resolver
   * (ADR-0012) — deliberately does NOT require `customer.read`/`.manage`,
   * only Tenant isolation + Data Scope, matching that binding decision
   * literally: an attachment's authorization is the parent's Data Scope,
   * not a second, independent permission check.
   */
  async canAccessForDocument(actor: ActorContext, customerId: string): Promise<boolean> {
    const customer = await this.repo.findById(customerId);
    if (!customer || customer.tenantId !== actor.tenantId) return false;
    return this.rbac.isCustomerContextScopeCovered(actor.userId, {
      customerId: customer.id,
      ownerOrganizationUnitId: customer.ownerOrganizationUnitId,
    });
  }

  async createContact(actor: ActorContext, input: CreateCustomerContactInput) {
    await this.rbac.requirePermission(actor.userId, "customer.manage");
    const customer = await this.getAuthorized(actor, input.customerId);

    const contact = await this.contactRepo.create(
      { ...input, tenantId: actor.tenantId },
      actor.userId,
    );

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "customer.contact_created",
      entityType: "customer_contact",
      entityId: contact.id,
      metadata: { customerId: customer.id, name: contact.name },
    });

    return contact;
  }

  async listContacts(actor: ActorContext, customerId: string) {
    await this.rbac.requirePermission(actor.userId, "customer.read");
    await this.getAuthorized(actor, customerId);
    return this.contactRepo.listByCustomer(customerId);
  }
}
