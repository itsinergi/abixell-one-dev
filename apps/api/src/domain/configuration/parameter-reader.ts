/**
 * Read port for a business module that needs one configured number.
 *
 * Resolves Client → System → product default for the tenant (the same
 * trusted-caller posture as `getEffectiveParameterValueForTrustedCaller`:
 * the caller needs no `config.read`). A missing parameter, or a stored value
 * that is not a finite integer, yields `fallback` — the constant the code used
 * before the value became configurable — so an unconfigured tenant behaves
 * exactly as it did.
 */
export interface ParameterReader {
  getInteger(tenantId: string, code: string, fallback: number): Promise<number>;
}
