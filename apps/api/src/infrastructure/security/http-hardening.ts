import { isIP } from "node:net";

const DEFAULT_CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    return origin.replace(/\/$/, "");
  }
}

function parseOriginList(value: string | undefined): string[] {
  if (!value) return DEFAULT_CORS_ORIGINS;
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
    .map(normalizeOrigin);
}

export function getAllowedCorsOrigins(): string[] {
  return parseOriginList(process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN);
}

export function isCorsOriginAllowed(origin: string | undefined, allowedOrigins = getAllowedCorsOrigins()): boolean {
  if (!origin) return true;
  return allowedOrigins.includes(normalizeOrigin(origin));
}


const PROXY_ADDR_SENTINELS = new Set(["loopback", "uniqueloopback", "linklocal", "uniquelinklocal"]);

/**
 * Client-IP trust configuration (Fastify `trustProxy`).
 *
 * Fastify 5.12 treats a numeric trustProxy as fail-closed (always false) —
 * see `getTrustProxyFn()` in fastify/lib/request.js — so a hop-count-only
 * value would silently ignore forwarded headers while also being
 * insufficient to validate the immediate peer. This project therefore:
 * - defaults to `trustProxy: false` (so X-Forwarded-* is ignored),
 * - only trusts forwarded headers when `TRUST_PROXY` is an explicit,
 *   deployment-controlled IP/CIDR allowlist (or an `@fastify/proxy-addr`
 *   sentinel: `loopback`, `uniqueloopback`, `linklocal`, `uniquelinklocal`),
 * - rejects `TRUST_PROXY=true`/`TRUST_PROXY=1` (trust-all is not a supported
 *   configuration — it would trust forwarded headers from any peer,
 *   including a direct attacker), and
 * - rejects `TRUST_PROXY_HOPS` at startup and any unparseable `TRUST_PROXY`
 *   value, so misconfiguration fails startup instead of silently becoming
 *   overly trusted (or silently ignored).
 *
 * Exported as a pure function (env is an explicit parameter, defaulting to
 * `process.env`) so tests can exercise the exact validation/resolution logic
 * `buildApp()` uses, without needing to mutate global process.env or bypass
 * this function via a hand-built Fastify instance.
 */
export function resolveTrustProxy(env: NodeJS.ProcessEnv = process.env): false | string {
  const trusted = env.TRUST_PROXY?.trim();
  if (env.TRUST_PROXY_HOPS !== undefined) {
    throw new Error(
      "TRUST_PROXY_HOPS is no longer supported: set explicit TRUST_PROXY address/CIDR allowlist or leave unset for secure default (false) — see infrastructure/security/http-hardening.ts",
    );
  }
  if (trusted === undefined || trusted === "") return false;
  if (trusted === "false" || trusted === "0") return false;
  if (trusted === "true" || trusted === "1") {
    throw new Error(
      `Invalid TRUST_PROXY value: ${JSON.stringify(trusted)} — trust-all is not permitted; set an explicit IP/CIDR allowlist (e.g. "10.0.0.1" or "10.0.0.0/28,172.16.0.5")`,
    );
  }
  const entries = trusted.split(",").map((s) => s.trim()).filter(Boolean);
  if (entries.length === 0) return false;
  for (const entry of entries) {
    if (PROXY_ADDR_SENTINELS.has(entry)) continue;
    const slash = entry.indexOf("/");
    const ip = slash === -1 ? entry : entry.slice(0, slash);
    const mask = slash === -1 ? null : entry.slice(slash + 1);
    if (!isIP(ip)) throw new Error(`Invalid TRUST_PROXY value: ${JSON.stringify(trusted)}`);
    if (mask !== null) {
      // Digit-only mask (no sign, no decimal, no trailing garbage), within
      // the valid CIDR range for the address family. `/^\d+$/` (escaped) is
      // required here — an unescaped `/^d+$/` matches the literal letter
      // "d" and rejects every numeric mask, e.g. "10.0.0.0/28".
      const maxMask = ip.includes(":") ? 128 : 32;
      if (!/^\d+$/.test(mask) || Number(mask) > maxMask) {
        throw new Error(`Invalid TRUST_PROXY value: ${JSON.stringify(trusted)}`);
      }
    }
  }
  return trusted;
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getGlobalRateLimitConfig(): { max: number; timeWindow: string } {
  return {
    max: readPositiveIntegerEnv("RATE_LIMIT_GLOBAL_MAX", readPositiveIntegerEnv("RATE_LIMIT_MAX", 1200)),
    timeWindow: process.env.RATE_LIMIT_WINDOW ?? "1 minute",
  };
}

export function getLoginRateLimitConfig(): { max: number; timeWindow: string } {
  return {
    max: readPositiveIntegerEnv("AUTH_RATE_LIMIT_MAX", 10),
    timeWindow: process.env.AUTH_RATE_LIMIT_WINDOW ?? "1 minute",
  };
}

/** Self-service profile edit (PATCH /me) verifies the caller's current
 * password with bcrypt, so a wrong-password guess costs the server the
 * same as a login attempt and this route needs its own budget rather
 * than riding the global floor. The ceiling is looser than login's: the
 * same endpoint also carries ordinary name edits, which are not guesses. */
export function getProfileUpdateRateLimitConfig(): { max: number; timeWindow: string } {
  return {
    max: readPositiveIntegerEnv("PROFILE_UPDATE_RATE_LIMIT_MAX", 30),
    timeWindow: process.env.PROFILE_UPDATE_RATE_LIMIT_WINDOW ?? "1 minute",
  };
}
