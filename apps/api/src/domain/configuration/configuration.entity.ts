/**
 * Configuration & Metadata Foundation domain types, per
 * 05-Configuration-Metadata-Engine.md. Three layers:
 *   - Catalog (Product Core): what CAN be configured (Module, FeatureFlag,
 *     TerminologyKey, ReferenceDataType) — seeded via migration, never
 *     written by a Tenant.
 *   - Tenant Configuration Store: what a Tenant actually chose.
 *   - Schema Registry (MetadataRegistryEntry): validates values before
 *     they're written to the Tenant Configuration Store.
 */

export interface ModuleCatalogItem {
  id: string;
  code: string;
  name: string;
  description: string;
}

export interface ModuleActivationStatus {
  moduleId: string;
  moduleCode: string;
  moduleName: string;
  isActive: boolean;
  updatedAt: Date | null;
}

export interface FeatureFlagCatalogItem {
  id: string;
  code: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
}

export type ConfigScope =
  | { type: "tenant" }
  | { type: "organization_unit"; organizationUnitId: string };

export interface FeatureFlagAssignment {
  id: string;
  featureFlagCode: string;
  isEnabled: boolean;
  scopeType: "tenant" | "organization_unit";
  scopeOrganizationUnitId: string | null;
}

/** The flag value that actually applies, after resolving scope precedence
 * (Organization Unit override > Tenant override > catalog default). */
export interface EffectiveFeatureFlag {
  code: string;
  name: string;
  isEnabled: boolean;
  source: "catalog_default" | "tenant" | "organization_unit";
}

export interface TerminologyKeyCatalogItem {
  id: string;
  code: string;
  defaultLabel: string;
  description: string;
}

export interface EffectiveTerminology {
  code: string;
  defaultLabel: string;
  value: string;
  isOverridden: boolean;
}

export interface ReferenceDataTypeCatalogItem {
  id: string;
  code: string;
  name: string;
  description: string;
}

export interface ReferenceDataItem {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

export interface NumberingSequence {
  id: string;
  code: string;
  pattern: string;
  currentSequence: number;
}

export interface MetadataRegistryEntry {
  area: string;
  key: string;
  jsonSchema: unknown;
  description: string;
}

export interface ConfigurationRepository {
  getMetadataSchema(area: string, key: string): Promise<MetadataRegistryEntry | null>;

  // Module Activation
  listModuleCatalog(): Promise<ModuleCatalogItem[]>;
  listModuleActivations(tenantId: string): Promise<ModuleActivationStatus[]>;
  listActiveModuleCodes(tenantId: string): Promise<string[]>;
  setModuleActivation(
    tenantId: string,
    moduleCode: string,
    isActive: boolean,
    updatedBy: string,
  ): Promise<ModuleActivationStatus>;

  // Feature Flags
  listFeatureFlagCatalog(): Promise<FeatureFlagCatalogItem[]>;
  listFeatureFlagAssignments(tenantId: string): Promise<FeatureFlagAssignment[]>;
  upsertFeatureFlagAssignment(
    tenantId: string,
    featureFlagCode: string,
    isEnabled: boolean,
    scope: ConfigScope,
    updatedBy: string,
  ): Promise<FeatureFlagAssignment>;

  // Terminology
  listTerminologyCatalog(): Promise<TerminologyKeyCatalogItem[]>;
  listTerminologyOverrides(
    tenantId: string,
  ): Promise<Array<{ code: string; value: string }>>;
  upsertTerminologyOverride(
    tenantId: string,
    code: string,
    value: string,
    updatedBy: string,
  ): Promise<void>;

  // Reference Data
  listReferenceDataTypeCatalog(): Promise<ReferenceDataTypeCatalogItem[]>;
  listReferenceDataItems(tenantId: string, typeCode: string): Promise<ReferenceDataItem[]>;
  createReferenceDataItem(
    tenantId: string,
    typeCode: string,
    item: { code: string; label: string; sortOrder?: number },
    createdBy: string,
  ): Promise<ReferenceDataItem>;
  setReferenceDataItemActive(
    tenantId: string,
    typeCode: string,
    itemId: string,
    isActive: boolean,
    updatedBy: string,
  ): Promise<ReferenceDataItem | null>;

  // Numbering
  getNumberingSequence(tenantId: string, code: string): Promise<NumberingSequence | null>;
  createNumberingSequence(
    tenantId: string,
    code: string,
    pattern: string,
    createdBy: string,
  ): Promise<NumberingSequence>;
  /** Atomically increments and returns the new sequence value. */
  incrementNumberingSequence(tenantId: string, code: string): Promise<NumberingSequence>;
}
