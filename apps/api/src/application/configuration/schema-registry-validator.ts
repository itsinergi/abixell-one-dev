import { Ajv, type ValidateFunction } from "ajv";
import type { ConfigurationRepository } from "../../domain/configuration/configuration.entity.js";
import { ValidationError } from "../../domain/shared-kernel/errors.js";

const ajv = new Ajv({ allErrors: true, strict: false });
const compiledCache = new Map<string, ValidateFunction>();

/**
 * The Schema Registry made real: every Tenant-supplied configuration
 * value is validated against the JSON Schema stored in
 * `metadata_registry` (Product Core, migration-seeded) before it is
 * written anywhere. This is what makes "metadata sebagai sumber
 * kebenaran validasi" (05-Configuration-Metadata-Engine.md) an actual
 * mechanism instead of a design intention.
 */
export class SchemaRegistryValidator {
  constructor(private readonly repo: ConfigurationRepository) {}

  async validate(area: string, key: string, value: unknown): Promise<void> {
    const entry = await this.repo.getMetadataSchema(area, key);
    if (!entry) {
      // A missing registry entry is a Product Core bug (an area/key that
      // should have been seeded via migration wasn't), not a client
      // input error — fail loudly rather than silently skipping
      // validation.
      throw new ValidationError(
        `No Schema Registry entry for area='${area}' key='${key}' — cannot validate`,
      );
    }

    const cacheKey = `${area}:${key}`;
    let validateFn = compiledCache.get(cacheKey);
    if (!validateFn) {
      validateFn = ajv.compile(entry.jsonSchema as object);
      compiledCache.set(cacheKey, validateFn);
    }

    const valid = validateFn(value);
    if (!valid) {
      throw new ValidationError(
        `Value for '${area}.${key}' failed Schema Registry validation`,
        validateFn.errors,
      );
    }
  }
}
