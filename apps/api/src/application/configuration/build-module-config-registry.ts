import { MODULE_CONFIG_MANIFESTS } from "./manifests/index.js";
import { InMemoryModuleConfigRegistry } from "./module-config-registry.js";

/**
 * Builds and validates the registry from the shipped manifests — pure, no DB.
 * Shared by `syncModuleConfig` (writes the catalogue) and `ConfigurationService`
 * (reads `inUse` for the admin UI), so there is exactly one place a manifest is
 * turned into a registry.
 */
export function buildModuleConfigRegistry(): InMemoryModuleConfigRegistry {
  const registry = new InMemoryModuleConfigRegistry();
  for (const manifest of MODULE_CONFIG_MANIFESTS) registry.register(manifest);
  return registry;
}
