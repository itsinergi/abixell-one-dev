/**
 * Module Configuration Manifest (CORE-ROADMAP.md §4.15 Putaran 7, Opsi A,
 * keputusan 2026-10-28).
 *
 * The same registration-contract pattern as document types (§4.8 keputusan
 * #22): a module declares its own configuration parameters in code, next to
 * the code that reads them, instead of a migration seeding rows a human has
 * to keep in sync by hand. A manifest is data, not a side effect —
 * `ModuleConfigLoader` (application layer) is what turns the registered
 * manifests into `app_parameters` rows at boot.
 *
 * `moduleCode` MUST be a row already present in the `modules` table — the
 * database enforces this with `fk_app_parameters_module_code`. There is no
 * fallback: an unknown code fails boot loudly rather than silently dropping a
 * module's parameters.
 *
 * Values stay structured (CFG-R3): bounds are `constraints`, never a free-form
 * JSON Schema or an expression. The loader derives the Schema Registry entry
 * from `parameterType` + `constraints`, so the write path validates a range
 * exactly like it validates a type.
 */

export type ModuleConfigParameterType = "boolean" | "integer" | "decimal" | "string" | "json";
export type ModuleConfigParameterLevel = "S" | "C" | "O";

export interface ModuleConfigParameterConstraints {
  /** Inclusive bounds for `integer` / `decimal`. */
  minimum?: number;
  maximum?: number;
  /** Inclusive upper bound for `string`. */
  maxLength?: number;
}

export interface ModuleConfigParameterManifest {
  code: string;
  name: string;
  description: string;
  parameterType: ModuleConfigParameterType;
  /** Absent = the type's standard Schema Registry entry
   * (`app_parameter_values.value_<type>`). Present = the loader registers a
   * dedicated entry for this parameter. */
  constraints?: ModuleConfigParameterConstraints;
  /** Unit shown next to the value in the admin UI (e.g. "MB", "hari"). */
  unit?: string;
  defaultValue: unknown;
  allowedLevels: ModuleConfigParameterLevel[];
  orgOverrideAllowed: boolean;
  /** A guardrail parameter must not also allow Organization override — the
   * database CHECK `app_parameters_guardrail_check` enforces the same rule,
   * so a manifest that violates it fails at boot, not silently at runtime. */
  isGuardrail: boolean;
  /** False = declared and settable in the catalogue, but no code reads it yet.
   * The admin UI says so instead of offering a setting that changes nothing.
   * Default true. */
  inUse?: boolean;
  /** True = this row was seeded by an earlier migration (Epic 2 Wave 3
   * bridge) and already has a valid `app_parameters` row + Schema Registry
   * entry. The loader skips the DB sync for it entirely — the manifest entry
   * exists only so `inUse` can be looked up for the admin UI. Default false. */
  legacyRow?: boolean;
}

export interface ModuleConfigManifest {
  /** Must match a `modules.code` row. */
  moduleCode: string;
  parameters: ModuleConfigParameterManifest[];
}

/** Read side of the registry, as the configuration service sees it. */
export interface ModuleConfigLookup {
  findParameter(code: string): ModuleConfigParameterManifest | undefined;
}

/** The Schema Registry area every parameter value is validated under. */
export const PARAMETER_SCHEMA_AREA = "app_parameter_values";

/** `S,C,O` order is what the `allowed_levels` CHECK constraint accepts. */
export function encodeLevels(levels: ModuleConfigParameterLevel[]): string {
  return (["S", "C", "O"] as const).filter((level) => levels.includes(level)).join(",");
}
