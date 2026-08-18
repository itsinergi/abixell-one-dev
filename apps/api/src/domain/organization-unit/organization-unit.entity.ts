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
  /**
   * Checkpoint 0F / ADR-0009 (Hierarchical Data Scope, supersedes
   * ADR-0005's exact-match-only rule): every ancestor Organization Unit
   * id of `id`, INCLUDING `id` itself, walking up `parent_id` to the
   * root. A Data Scope assignment on any of these ids covers `id` — this
   * is the one place that upward walk is computed, reused by both
   * `RbacService` (permission checks) and `RbacRepository`
   * (role+scope queue resolution) so the two can never drift.
   */
  listAncestorIds(id: string): Promise<string[]>;
}
