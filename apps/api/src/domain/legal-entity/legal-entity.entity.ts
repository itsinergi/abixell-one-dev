export interface LegalEntity {
  id: string;
  tenantId: string;
  name: string;
  registrationNo: string | null;
  isActive: boolean;
  deactivatedAt: Date | null;
  deactivatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLegalEntityInput {
  tenantId: string;
  name: string;
  registrationNo?: string | null;
}

export interface UpdateLegalEntityInput {
  name: string;
  registrationNo?: string | null;
}

export interface LifecycleActor {
  userId: string;
  tenantId: string;
}

export interface LegalEntityRepository {
  create(input: CreateLegalEntityInput, createdBy: string | null): Promise<LegalEntity>;
  findById(id: string): Promise<LegalEntity | null>;
  listByTenant(tenantId: string): Promise<LegalEntity[]>;
  update(id: string, input: UpdateLegalEntityInput, actor: LifecycleActor): Promise<LegalEntity>;
  setActive(id: string, isActive: boolean, actor: LifecycleActor): Promise<LegalEntity>;
}
