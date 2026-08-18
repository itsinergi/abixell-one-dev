export interface LegalEntity {
  id: string;
  tenantId: string;
  name: string;
  registrationNo: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLegalEntityInput {
  tenantId: string;
  name: string;
  registrationNo?: string | null;
}

export interface LegalEntityRepository {
  create(input: CreateLegalEntityInput, createdBy: string | null): Promise<LegalEntity>;
  findById(id: string): Promise<LegalEntity | null>;
  listByTenant(tenantId: string): Promise<LegalEntity[]>;
}
