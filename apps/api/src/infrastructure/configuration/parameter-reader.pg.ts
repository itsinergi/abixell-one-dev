import type { ConfigurationService } from "../../application/configuration/configuration.service.js";
import type { ParameterReader } from "../../domain/configuration/parameter-reader.js";

/**
 * Thin adapter over `ConfigurationService`'s trusted-caller read: a business
 * module should not need `config.read` just to pick up its own tunable.
 *
 * Only a stored number, or a numeric string, counts. `null` / `undefined` /
 * `""` mean "not configured" and yield `fallback` — `Number(null)` is `0`, so
 * coercing blindly would turn a missing parameter into "zero attempts" or "0 MB
 * upload cap" instead of the constant the code used before.
 */
export class PgParameterReader implements ParameterReader {
  constructor(private readonly configuration: ConfigurationService) {}

  async getInteger(tenantId: string, code: string, fallback: number): Promise<number> {
    const value = await this.configuration.getEffectiveParameterValueForTrustedCaller(tenantId, code);
    if (value === null || value === undefined) return fallback;
    if (typeof value === "string" && value.trim() === "") return fallback;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isInteger(n) ? n : fallback;
  }
}
