export interface Tenant {
  id: string;
  code: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTenantInput {
  code: string;
  name: string;
}

export interface TenantRepository {
  create(input: CreateTenantInput, createdBy: string | null): Promise<Tenant>;
  findById(id: string): Promise<Tenant | null>;
  findByCode(code: string): Promise<Tenant | null>;
  list(): Promise<Tenant[]>;
}
