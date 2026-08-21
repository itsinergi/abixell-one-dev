export interface Contract {
  id: string;
  tenantId: string;
  customerId: string;
  code: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateContractInput {
  tenantId: string;
  customerId: string;
  code: string;
  name: string;
  startDate?: string | null;
  endDate?: string | null;
  status?: string;
}

export interface UpdateContractInput {
  code?: string;
  name?: string;
  startDate?: string | null;
  endDate?: string | null;
  status?: string;
}

export interface ContractRepository {
  create(input: CreateContractInput, createdBy: string | null): Promise<Contract>;
  update(id: string, input: UpdateContractInput, updatedBy: string | null): Promise<Contract | null>;
  findById(id: string): Promise<Contract | null>;
  listByCustomer(customerId: string): Promise<Contract[]>;
}
