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
  allowTenantAdd: boolean;
  isCore: boolean;
  classification: "category" | "type" | "status" | "unit" | "other";
}

export interface ReferenceDataItem {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  isCore: boolean;
}

export interface NumberingSequence {
  id: string;
  code: string;
  pattern: string;
  currentSequence: number;
}

export interface AppParameter {
  id: string;
  code: string;
  name: string;
  description: string;
  moduleCode: string;
  parameterType: "boolean" | "integer" | "decimal" | "string" | "json";
  schemaArea: string;
  schemaKey: string;
  defaultValue: unknown;
  allowedLevels: ParameterLevel[];
  orgOverrideAllowed: boolean;
  isGuardrail: boolean;
  isActive: boolean;
  /** §4.15 Putaran 7 — false when no code reads this parameter yet (manifest
   * `inUse: false`). Absent for a parameter whose manifest does not say either
   * way, which the UI should treat the same as true. */
  inUse?: boolean;
}

export type ParameterLevel = "S" | "C" | "O";

export interface AppParameterValue {
  id: string;
  tenantId: string;
  parameterId: string;
  level: ParameterLevel;
  clientScopeId: string | null;
  organizationScopeId: string | null;
  value: unknown;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface EffectiveParameterValue {
  code: string;
  value: unknown;
  sourceLevel: ParameterLevel | "product_default";
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
  getReferenceDataTypeByCode(code: string): Promise<ReferenceDataTypeCatalogItem | null>;
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

  // Parameters
  listAppParameters(): Promise<AppParameter[]>;
  getAppParameterByCode(code: string): Promise<AppParameter | null>;
  listParameterValues(tenantId: string, parameterId: string): Promise<AppParameterValue[]>;
  upsertParameterValue(input: {
    tenantId: string;
    parameterId: string;
    level: ParameterLevel;
    clientScopeId: string | null;
    organizationScopeId: string | null;
    value: unknown;
    updatedBy: string;
  }): Promise<AppParameterValue>;

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
