import type { Pool } from "pg";
import type {
  ConfigScope,
  ConfigurationRepository,
  FeatureFlagAssignment,
  FeatureFlagCatalogItem,
  MetadataRegistryEntry,
  ModuleActivationStatus,
  ModuleCatalogItem,
  NumberingSequence,
  ReferenceDataItem,
  ReferenceDataTypeCatalogItem,
  TerminologyKeyCatalogItem,
} from "../../../domain/configuration/configuration.entity.js";
import { NotFoundError } from "../../../domain/shared-kernel/errors.js";

export class PgConfigurationRepository implements ConfigurationRepository {
  constructor(private readonly pool: Pool) {}

  async getMetadataSchema(area: string, key: string): Promise<MetadataRegistryEntry | null> {
    const result = await this.pool.query(
      `SELECT * FROM metadata_registry WHERE area = $1 AND key = $2`,
      [area, key],
    );
    if (!result.rows[0]) return null;
    return {
      area: result.rows[0].area,
      key: result.rows[0].key,
      jsonSchema: result.rows[0].json_schema,
      description: result.rows[0].description,
    };
  }

  // --- Module Activation -------------------------------------------------

  async listModuleCatalog(): Promise<ModuleCatalogItem[]> {
    const result = await this.pool.query(`SELECT * FROM modules ORDER BY code`);
    return result.rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
    }));
  }

  async listModuleActivations(tenantId: string): Promise<ModuleActivationStatus[]> {
    const result = await this.pool.query(
      `SELECT m.id AS module_id, m.code AS module_code, m.name AS module_name,
              COALESCE(tma.is_active, false) AS is_active, tma.updated_at
         FROM modules m
         LEFT JOIN tenant_module_activations tma
           ON tma.module_id = m.id AND tma.tenant_id = $1
        ORDER BY m.code`,
      [tenantId],
    );
    return result.rows.map((r) => ({
      moduleId: r.module_id,
      moduleCode: r.module_code,
      moduleName: r.module_name,
      isActive: r.is_active,
      updatedAt: r.updated_at,
    }));
  }

  async setModuleActivation(
    tenantId: string,
    moduleCode: string,
    isActive: boolean,
    updatedBy: string,
  ): Promise<ModuleActivationStatus> {
    const moduleRow = await this.pool.query(`SELECT * FROM modules WHERE code = $1`, [
      moduleCode,
    ]);
    if (!moduleRow.rows[0]) throw new NotFoundError("Module", moduleCode);
    const moduleId = moduleRow.rows[0].id;

    const result = await this.pool.query(
      `INSERT INTO tenant_module_activations (tenant_id, module_id, is_active, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, module_id)
       DO UPDATE SET is_active = EXCLUDED.is_active, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING *`,
      [tenantId, moduleId, isActive, updatedBy],
    );
    return {
      moduleId,
      moduleCode: moduleRow.rows[0].code,
      moduleName: moduleRow.rows[0].name,
      isActive: result.rows[0].is_active,
      updatedAt: result.rows[0].updated_at,
    };
  }

  // --- Feature Flags -------------------------------------------------------

  async listFeatureFlagCatalog(): Promise<FeatureFlagCatalogItem[]> {
    const result = await this.pool.query(`SELECT * FROM feature_flags ORDER BY code`);
    return result.rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      defaultEnabled: r.default_enabled,
    }));
  }

  async listFeatureFlagAssignments(tenantId: string): Promise<FeatureFlagAssignment[]> {
    const result = await this.pool.query(
      `SELECT tff.id, ff.code AS feature_flag_code, tff.is_enabled,
              tff.scope_type, tff.scope_organization_unit_id
         FROM tenant_feature_flags tff
         JOIN feature_flags ff ON ff.id = tff.feature_flag_id
        WHERE tff.tenant_id = $1`,
      [tenantId],
    );
    return result.rows.map((r) => ({
      id: r.id,
      featureFlagCode: r.feature_flag_code,
      isEnabled: r.is_enabled,
      scopeType: r.scope_type,
      scopeOrganizationUnitId: r.scope_organization_unit_id,
    }));
  }

  async upsertFeatureFlagAssignment(
    tenantId: string,
    featureFlagCode: string,
    isEnabled: boolean,
    scope: ConfigScope,
    updatedBy: string,
  ): Promise<FeatureFlagAssignment> {
    const flagRow = await this.pool.query(`SELECT * FROM feature_flags WHERE code = $1`, [
      featureFlagCode,
    ]);
    if (!flagRow.rows[0]) throw new NotFoundError("FeatureFlag", featureFlagCode);
    const featureFlagId = flagRow.rows[0].id;

    const scopeOrgUnitId = scope.type === "organization_unit" ? scope.organizationUnitId : null;

    // Two partial unique indexes back this upsert (see migration
    // 1755700000000): one for scope_type='tenant', one for
    // scope_type='organization_unit'. ON CONFLICT must target the
    // specific index because a plain column-list target won't match a
    // partial index.
    const conflictTarget =
      scope.type === "tenant"
        ? `(tenant_id, feature_flag_id) WHERE scope_type = 'tenant'`
        : `(tenant_id, feature_flag_id, scope_organization_unit_id) WHERE scope_type = 'organization_unit'`;

    const result = await this.pool.query(
      `INSERT INTO tenant_feature_flags
         (tenant_id, feature_flag_id, is_enabled, scope_type, scope_organization_unit_id, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ${conflictTarget}
       DO UPDATE SET is_enabled = EXCLUDED.is_enabled, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING *`,
      [tenantId, featureFlagId, isEnabled, scope.type, scopeOrgUnitId, updatedBy],
    );
    const row = result.rows[0];
    return {
      id: row.id,
      featureFlagCode,
      isEnabled: row.is_enabled,
      scopeType: row.scope_type,
      scopeOrganizationUnitId: row.scope_organization_unit_id,
    };
  }

  // --- Terminology -----------------------------------------------------------

  async listTerminologyCatalog(): Promise<TerminologyKeyCatalogItem[]> {
    const result = await this.pool.query(`SELECT * FROM terminology_keys ORDER BY code`);
    return result.rows.map((r) => ({
      id: r.id,
      code: r.code,
      defaultLabel: r.default_label,
      description: r.description,
    }));
  }

  async listTerminologyOverrides(
    tenantId: string,
  ): Promise<Array<{ code: string; value: string }>> {
    const result = await this.pool.query(
      `SELECT tk.code, tto.value
         FROM tenant_terminology_overrides tto
         JOIN terminology_keys tk ON tk.id = tto.terminology_key_id
        WHERE tto.tenant_id = $1`,
      [tenantId],
    );
    return result.rows.map((r) => ({ code: r.code, value: r.value }));
  }

  async upsertTerminologyOverride(
    tenantId: string,
    code: string,
    value: string,
    updatedBy: string,
  ): Promise<void> {
    const keyRow = await this.pool.query(`SELECT id FROM terminology_keys WHERE code = $1`, [
      code,
    ]);
    if (!keyRow.rows[0]) throw new NotFoundError("TerminologyKey", code);

    await this.pool.query(
      `INSERT INTO tenant_terminology_overrides (tenant_id, terminology_key_id, value, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, terminology_key_id)
       DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [tenantId, keyRow.rows[0].id, value, updatedBy],
    );
  }

  // --- Reference Data -----------------------------------------------------

  async listReferenceDataTypeCatalog(): Promise<ReferenceDataTypeCatalogItem[]> {
    const result = await this.pool.query(`SELECT * FROM reference_data_types ORDER BY code`);
    return result.rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
    }));
  }

  async listReferenceDataItems(tenantId: string, typeCode: string): Promise<ReferenceDataItem[]> {
    const result = await this.pool.query(
      `SELECT tri.* FROM tenant_reference_data_items tri
         JOIN reference_data_types rdt ON rdt.id = tri.reference_data_type_id
        WHERE tri.tenant_id = $1 AND rdt.code = $2
        ORDER BY tri.sort_order, tri.code`,
      [tenantId, typeCode],
    );
    return result.rows.map((r) => ({
      id: r.id,
      code: r.code,
      label: r.label,
      sortOrder: r.sort_order,
      isActive: r.is_active,
    }));
  }

  async createReferenceDataItem(
    tenantId: string,
    typeCode: string,
    item: { code: string; label: string; sortOrder?: number },
    createdBy: string,
  ): Promise<ReferenceDataItem> {
    const typeRow = await this.pool.query(`SELECT id FROM reference_data_types WHERE code = $1`, [
      typeCode,
    ]);
    if (!typeRow.rows[0]) throw new NotFoundError("ReferenceDataType", typeCode);

    const result = await this.pool.query(
      `INSERT INTO tenant_reference_data_items
         (tenant_id, reference_data_type_id, code, label, sort_order, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       RETURNING *`,
      [tenantId, typeRow.rows[0].id, item.code, item.label, item.sortOrder ?? 0, createdBy],
    );
    const row = result.rows[0];
    return {
      id: row.id,
      code: row.code,
      label: row.label,
      sortOrder: row.sort_order,
      isActive: row.is_active,
    };
  }

  /** Checkpoint 1C.6 — generic additive: activate/deactivate a reference-data
   * item, scoped to (tenant, type, id) so a caller can only ever touch items
   * of the type it manages. Returns null if no such item (wrong tenant/type/id). */
  async setReferenceDataItemActive(
    tenantId: string,
    typeCode: string,
    itemId: string,
    isActive: boolean,
    updatedBy: string,
  ): Promise<ReferenceDataItem | null> {
    const result = await this.pool.query(
      `UPDATE tenant_reference_data_items tri
          SET is_active = $4, updated_by = $5, updated_at = now()
         FROM reference_data_types rdt
        WHERE tri.reference_data_type_id = rdt.id
          AND tri.tenant_id = $1 AND rdt.code = $2 AND tri.id = $3
       RETURNING tri.id, tri.code, tri.label, tri.sort_order, tri.is_active`,
      [tenantId, typeCode, itemId, isActive, updatedBy],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { id: row.id, code: row.code, label: row.label, sortOrder: row.sort_order, isActive: row.is_active };
  }

  // --- Numbering -------------------------------------------------------------

  async getNumberingSequence(tenantId: string, code: string): Promise<NumberingSequence | null> {
    const result = await this.pool.query(
      `SELECT * FROM numbering_sequences WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    );
    if (!result.rows[0]) return null;
    return {
      id: result.rows[0].id,
      code: result.rows[0].code,
      pattern: result.rows[0].pattern,
      currentSequence: Number(result.rows[0].current_sequence),
    };
  }

  async createNumberingSequence(
    tenantId: string,
    code: string,
    pattern: string,
    createdBy: string,
  ): Promise<NumberingSequence> {
    const result = await this.pool.query(
      `INSERT INTO numbering_sequences (tenant_id, code, pattern, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [tenantId, code, pattern, createdBy],
    );
    return {
      id: result.rows[0].id,
      code: result.rows[0].code,
      pattern: result.rows[0].pattern,
      currentSequence: Number(result.rows[0].current_sequence),
    };
  }

  async incrementNumberingSequence(tenantId: string, code: string): Promise<NumberingSequence> {
    // Single atomic UPDATE ... RETURNING — Postgres guarantees this is
    // race-free under concurrent callers without needing an explicit
    // transaction/lock (the row-level lock is implicit for the duration
    // of the UPDATE).
    const result = await this.pool.query(
      `UPDATE numbering_sequences
          SET current_sequence = current_sequence + 1, updated_at = now()
        WHERE tenant_id = $1 AND code = $2
        RETURNING *`,
      [tenantId, code],
    );
    if (!result.rows[0]) throw new NotFoundError("NumberingSequence", code);
    return {
      id: result.rows[0].id,
      code: result.rows[0].code,
      pattern: result.rows[0].pattern,
      currentSequence: Number(result.rows[0].current_sequence),
    };
  }
}
