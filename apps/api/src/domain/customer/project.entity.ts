export interface Project {
  id: string;
  tenantId: string;
  customerId: string;
  contractId: string | null;
  code: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectInput {
  tenantId: string;
  customerId: string;
  contractId?: string | null;
  code: string;
  name: string;
  status?: string;
}

export interface UpdateProjectInput {
  contractId?: string | null;
  code?: string;
  name?: string;
  status?: string;
}

export interface ProjectRepository {
  create(input: CreateProjectInput, createdBy: string | null): Promise<Project>;
  update(id: string, input: UpdateProjectInput, updatedBy: string | null): Promise<Project | null>;
  findById(id: string): Promise<Project | null>;
  listByCustomer(customerId: string): Promise<Project[]>;
}
