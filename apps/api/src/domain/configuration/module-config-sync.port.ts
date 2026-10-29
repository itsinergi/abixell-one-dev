import type { ModuleConfigParameterManifest } from "./module-config-manifest.entity.js";

/** One manifest parameter, resolved to what Postgres must hold for it. */
export interface ModuleConfigSyncEntry {
  moduleCode: string;
  parameter: ModuleConfigParameterManifest;
  /** `metadata_registry.key` under area `app_parameter_values`. */
  schemaKey: string;
  /** Set only when the parameter carries its own constraints; absent = the
   * standard `value_<type>` entry already seeded by migration. */
  dedicatedSchema: Record<string, unknown> | null;
}

/**
 * Writes resolved manifest entries into the global catalogue
 * (`metadata_registry` + `app_parameters`) in one transaction. Both tables are
 * code-owned Product Core, so a re-run converges to the manifest: it never
 * touches `app_parameter_values` (tenant choices) or `app_parameters.is_active`
 * (an operator may have retired a row).
 */
export interface ModuleConfigSyncPort {
  sync(entries: ModuleConfigSyncEntry[]): Promise<{ upserted: number }>;
}
