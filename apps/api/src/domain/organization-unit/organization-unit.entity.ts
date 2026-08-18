export interface OrganizationUnit {
  id: string;
  tenantId: string;
  legalEntityId: string;
  parentId: string | null;
  name: string;
  unitType: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrganizationUnitInput {
  tenantId: string;
  legalEntityId: string;
  parentId?: string | null;
  name: string;
  unitType?: string;
}

export interface OrganizationUnitRepository {
  create(
    input: CreateOrganizationUnitInput,
    createdBy: string | null,
  ): Promise<OrganizationUnit>;
  findById(id: string): Promise<OrganizationUnit | null>;
  listByTenant(tenantId: string): Promise<OrganizationUnit[]>;
}
