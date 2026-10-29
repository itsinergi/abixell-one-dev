import type { Pool } from "pg";
import type {
  ModuleConfigSyncEntry,
  ModuleConfigSyncPort,
} from "../../../domain/configuration/module-config-sync.port.js";
import {
  PARAMETER_SCHEMA_AREA,
  encodeLevels,
} from "../../../domain/configuration/module-config-manifest.entity.js";

/**
 * `app_parameters` and `metadata_registry` are global, code-owned catalogue
 * tables (no tenant_id). The sync converges them to the manifest and nothing
 * else: `app_parameter_values` (what a tenant chose) is never touched, and
 * `is_active` is left alone so a row an operator retired stays retired.
 */
export class PgModuleConfigSyncRepository implements ModuleConfigSyncPort {
  constructor(private readonly pool: Pool) {}

  async sync(entries: ModuleConfigSyncEntry[]): Promise<{ upserted: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      for (const entry of entries) {
        if (entry.dedicatedSchema) {
          await client.query(
            `INSERT INTO metadata_registry (area, key, json_schema, description)
             VALUES ($1, $2, $3::jsonb, $4)
             ON CONFLICT (area, key)
             DO UPDATE SET json_schema = EXCLUDED.json_schema,
                           description = EXCLUDED.description`,
            [
              PARAMETER_SCHEMA_AREA,
              entry.schemaKey,
              JSON.stringify(entry.dedicatedSchema),
              `Bounds for parameter ${entry.parameter.code}`,
            ],
          );
        }

        const p = entry.parameter;
        await client.query(
          `INSERT INTO app_parameters
             (code, name, description, module_code, parameter_type,
              schema_area, schema_key, default_value, allowed_levels,
              org_override_allowed, is_guardrail, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, true)
           ON CONFLICT (code)
           DO UPDATE SET name = EXCLUDED.name,
                         description = EXCLUDED.description,
                         module_code = EXCLUDED.module_code,
                         parameter_type = EXCLUDED.parameter_type,
                         schema_area = EXCLUDED.schema_area,
                         schema_key = EXCLUDED.schema_key,
                         default_value = EXCLUDED.default_value,
                         allowed_levels = EXCLUDED.allowed_levels,
                         org_override_allowed = EXCLUDED.org_override_allowed,
                         is_guardrail = EXCLUDED.is_guardrail,
                         updated_at = now()`,
          [
            p.code,
            p.name,
            p.description,
            entry.moduleCode,
            p.parameterType,
            PARAMETER_SCHEMA_AREA,
            entry.schemaKey,
            JSON.stringify(p.defaultValue),
            encodeLevels(p.allowedLevels),
            p.orgOverrideAllowed,
            p.isGuardrail,
          ],
        );
      }

      await client.query("COMMIT");
      return { upserted: entries.length };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
