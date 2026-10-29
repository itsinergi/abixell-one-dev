import type {
  ModuleConfigLookup,
  ModuleConfigManifest,
  ModuleConfigParameterManifest,
} from "../../domain/configuration/module-config-manifest.entity.js";

/**
 * In-memory index over every registered manifest. Built once at boot from
 * `MODULE_CONFIG_MANIFESTS` and handed to both `ModuleConfigLoader` (which
 * writes it into Postgres) and `ConfigurationService` (which reads
 * `inUse`/`legacyRow` for the admin UI without a second DB round trip).
 */
export class InMemoryModuleConfigRegistry implements ModuleConfigLookup {
  private readonly manifests = new Map<string, ModuleConfigManifest>();
  private readonly parametersByCode = new Map<string, ModuleConfigParameterManifest>();

  register(manifest: ModuleConfigManifest): void {
    if (this.manifests.has(manifest.moduleCode)) {
      throw new Error(`Module config manifest already registered for '${manifest.moduleCode}'`);
    }
    this.manifests.set(manifest.moduleCode, manifest);
    for (const parameter of manifest.parameters) {
      if (this.parametersByCode.has(parameter.code)) {
        throw new Error(`Parameter code '${parameter.code}' registered by more than one manifest`);
      }
      this.parametersByCode.set(parameter.code, parameter);
    }
  }

  getManifest(moduleCode: string): ModuleConfigManifest | undefined {
    return this.manifests.get(moduleCode);
  }

  getAllManifests(): ModuleConfigManifest[] {
    return [...this.manifests.values()];
  }

  findParameter(code: string): ModuleConfigParameterManifest | undefined {
    return this.parametersByCode.get(code);
  }
}
