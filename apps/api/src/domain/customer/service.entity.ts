/**
 * Service catalog (Tenant-level Product/Client Configuration data — see
 * migration header) + Service Assignment ("Service Assigned" step of the
 * 1A E2E target): a Service linked to a Customer, optionally narrowed to
 * a Contract/Project/Site, optionally with an Internal PIC.
 */

export interface Service {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateServiceInput {
  tenantId: string;
  code: string;
  name: string;
  description?: string | null;
}

export interface ServiceRepository {
  create(input: CreateServiceInput, createdBy: string | null): Promise<Service>;
  listByTenant(tenantId: string): Promise<Service[]>;
}

export interface CustomerServiceLink {
  id: string;
  tenantId: string;
  customerId: string;
  serviceId: string;
  contractId: string | null;
  projectId: string | null;
  siteId: string | null;
  internalPicUserId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCustomerServiceLinkInput {
  tenantId: string;
  customerId: string;
  serviceId: string;
  contractId?: string | null;
  projectId?: string | null;
  siteId?: string | null;
  internalPicUserId?: string | null;
}

export interface CustomerServiceLinkRepository {
  create(
    input: CreateCustomerServiceLinkInput,
    createdBy: string | null,
  ): Promise<CustomerServiceLink>;
  listByCustomer(customerId: string): Promise<CustomerServiceLink[]>;
}
