import { Ajv } from "ajv";
import type {
  ModuleConfigManifest,
  ModuleConfigParameterManifest,
} from "../../domain/configuration/module-config-manifest.entity.js";
import type {
  ModuleConfigSyncEntry,
  ModuleConfigSyncPort,
} from "../../domain/configuration/module-config-sync.port.js";

const ajv = new Ajv({ allErrors: true, strict: false });

const TYPE_TO_JSON_SCHEMA_TYPE: Record<ModuleConfigParameterManifest["parameterType"], string> = {
  boolean: "boolean",
  integer: "integer",
  decimal: "number",
  string: "string",
  json: "object",
};

/** `null` = no constraints, so the standard `value_<type>` entry applies. */
export function buildDedicatedSchema(
  parameter: ModuleConfigParameterManifest,
): Record<string, unknown> | null {
  const constraints = parameter.constraints;
  if (!constraints) return null;

  const isNumeric = parameter.parameterType === "integer" || parameter.parameterType === "decimal";
  if ((constraints.minimum !== undefined || constraints.maximum !== undefined) && !isNumeric) {
    throw new Error(`Parameter '${parameter.code}': minimum/maximum apply to integer/decimal only`);
  }
  if (constraints.maxLength !== undefined && parameter.parameterType !== "string") {
    throw new Error(`Parameter '${parameter.code}': maxLength applies to string only`);
  }

  const schema: Record<string, unknown> = { type: TYPE_TO_JSON_SCHEMA_TYPE[parameter.parameterType] };
  if (constraints.minimum !== undefined) schema.minimum = constraints.minimum;
  if (constraints.maximum !== undefined) schema.maximum = constraints.maximum;
  if (constraints.maxLength !== undefined) schema.maxLength = constraints.maxLength;
  return schema;
}

function assertManifestParameter(
  moduleCode: string,
  parameter: ModuleConfigParameterManifest,
  schema: Record<string, unknown> | null,
): void {
  const where = `Parameter '${parameter.code}' (module '${moduleCode}')`;

  if (!parameter.code.startsWith(`${moduleCode}.`)) {
    throw new Error(`${where}: code must start with '${moduleCode}.'`);
  }
  if (parameter.isGuardrail && parameter.orgOverrideAllowed) {
    throw new Error(`${where}: a guardrail cannot allow Organization override`);
  }
  if (parameter.allowedLevels.length === 0) {
    throw new Error(`${where}: allowedLevels is empty`);
  }
  if (parameter.allowedLevels.includes("O") && !parameter.orgOverrideAllowed) {
    throw new Error(`${where}: level 'O' listed but orgOverrideAllowed is false`);
  }
  if (new Set(parameter.allowedLevels).size !== parameter.allowedLevels.length) {
    throw new Error(`${where}: allowedLevels has duplicates`);
  }

  // The default must satisfy the same schema every tenant write is held to,
  // otherwise the product ships a default its own validator would reject.
  if (schema) {
    const validate = ajv.compile(schema);
    if (!validate(parameter.defaultValue)) {
      throw new Error(`${where}: defaultValue ${JSON.stringify(parameter.defaultValue)} violates its own constraints`);
    }
  }
}

/**
 * Turns the registered manifests into catalogue rows at boot (§4.15 Putaran 7).
 *
 * Fails the whole boot on a bad manifest — a wrong module code, a default that
 * breaks its own bounds, a guardrail that allows an override. Registering half
 * a catalogue and carrying on would hide exactly the drift this contract exists
 * to prevent.
 */
export class ModuleConfigLoader {
  constructor(private readonly sync: ModuleConfigSyncPort) {}

  async load(manifests: readonly ModuleConfigManifest[]): Promise<{ upserted: number }> {
    const entries: ModuleConfigSyncEntry[] = [];

    for (const manifest of manifests) {
      for (const parameter of manifest.parameters) {
        // Rows seeded by an earlier migration already hold a valid catalogue
        // entry; the manifest describes them for the UI only.
        if (parameter.legacyRow) continue;

        const dedicatedSchema = buildDedicatedSchema(parameter);
        assertManifestParameter(manifest.moduleCode, parameter, dedicatedSchema);
        entries.push({
          moduleCode: manifest.moduleCode,
          parameter,
          schemaKey: dedicatedSchema ? parameter.code : `value_${parameter.parameterType}`,
          dedicatedSchema,
        });
      }
    }

    if (entries.length === 0) return { upserted: 0 };
    return this.sync.sync(entries);
  }
}
