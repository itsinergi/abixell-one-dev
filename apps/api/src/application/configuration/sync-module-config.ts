import type { Pool } from "pg";
import { PgModuleConfigSyncRepository } from "../../infrastructure/persistence/repositories/module-config-sync.repository.pg.js";
import { buildModuleConfigRegistry } from "./build-module-config-registry.js";
import { ModuleConfigLoader } from "./module-config-loader.js";

/**
 * The one entry point that turns the code-owned manifests into catalogue rows.
 * `main.ts` calls it before the server listens; an integration test that wants
 * the catalogue calls the same function, so there is no second path to drift.
 *
 * Idempotent: the catalogue is global and code-owned, and a second run converges
 * to the same rows. Safe to run from several replicas at once — each upsert is a
 * single statement on a unique key.
 */
export async function syncModuleConfig(pool: Pool): Promise<{ upserted: number }> {
  // Building the registry also checks the manifests against each other
  // (duplicate module code, a parameter code claimed twice) before the DB is touched.
  const registry = buildModuleConfigRegistry();
  return new ModuleConfigLoader(new PgModuleConfigSyncRepository(pool)).load(registry.getAllManifests());
}
