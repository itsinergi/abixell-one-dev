/**
 * Customer Foundation (Checkpoint 1A), per Phase 1 instruction section 2.
 * Customer + Customer Contact/PIC. `ownerOrganizationUnitId` is the
 * INTERNAL side of Data Scope (which internal team owns this Customer);
 * the EXTERNAL side (a Customer User only seeing their own Customer) is
 * the new `customer` Data Scope dimension, see ADR-0011 and
 * `RbacService.requireCustomerContextScope`.
 */

export interface Customer {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  /** Customer Account Status — free text by design (Client Configuration
   * can extend the vocabulary; Product Core does not hardcode it). */
  status: string;
  ownerOrganizationUnitId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCustomerInput {
  tenantId: string;
  code: string;
  name: string;
  status?: string;
  ownerOrganizationUnitId?: string | null;
  notes?: string | null;
}

export interface UpdateCustomerInput {
  code?: string;
  name?: string;
  status?: string;
  ownerOrganizationUnitId?: string | null;
  notes?: string | null;
}

export interface CustomerRepository {
  create(input: CreateCustomerInput, createdBy: string | null): Promise<Customer>;
  update(id: string, input: UpdateCustomerInput, updatedBy: string | null): Promise<Customer | null>;
  findById(id: string): Promise<Customer | null>;
  listByTenant(tenantId: string): Promise<Customer[]>;
}

export interface CustomerContact {
  id: string;
  tenantId: string;
  customerId: string;
  name: string;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCustomerContactInput {
  tenantId: string;
  customerId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  isPrimary?: boolean;
}

export interface UpdateCustomerContactInput {
  name?: string;
  email?: string | null;
  phone?: string | null;
  isPrimary?: boolean;
}

export interface CustomerContactRepository {
  create(input: CreateCustomerContactInput, createdBy: string | null): Promise<CustomerContact>;
  update(id: string, input: UpdateCustomerContactInput, updatedBy: string | null): Promise<CustomerContact | null>;
  findById(id: string): Promise<CustomerContact | null>;
  listByCustomer(customerId: string): Promise<CustomerContact[]>;
}
