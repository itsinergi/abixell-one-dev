import type { ActorContext } from "../shared-kernel/audit-context.js";

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

export interface UpdateTenantInput {
  name: string;
}

export interface TenantRepository {
  create(input: CreateTenantInput, createdBy: string | null): Promise<Tenant>;
  findById(id: string): Promise<Tenant | null>;
  findByCode(code: string): Promise<Tenant | null>;
  list(): Promise<Tenant[]>;
  updateName(input: UpdateTenantInput, actor: ActorContext): Promise<{ name: string }>;
}
