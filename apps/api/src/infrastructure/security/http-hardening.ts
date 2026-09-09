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


/**
 * Client-IP trust configuration (Fastify trustProxy).
 *
 * Fastify 5.12 treats a numeric trustProxy as fail-closed (always false) so a
 * hop-count-only value would silently ignore forwarded headers while also
 * being insufficient to validate the immediate peer. This project therefore:
 * - defaults to trustProxy: false (so X-Forwarded-* is ignored),
 * - only trusts forwarded headers when TRUST_PROXY is an explicit, deployment-
 *   controlled address/CIDR allowlist, and
 * - rejects TRUST_PROXY_HOPS at startup and any unparseable TRUST_PROXY value.
 * Actual resolution lives in src/app.ts:resolveTrustProxy().
 */
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
