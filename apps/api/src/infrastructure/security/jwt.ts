import jwt from "jsonwebtoken";

export interface AccessTokenPayload {
  sub: string; // user id
  tenantId: string;
  // Epic 1 (§4.1 B): the active Role lives in the server-side `sessions` row,
  // not in the token. `sessionId` is only the key that resolves it on every
  // request, so a role switch takes effect immediately.
  sessionId: string;
  // Permissions are deliberately NOT embedded in the token: they are
  // re-fetched from the database on every request (RbacService), so a
  // permission/role change takes effect immediately instead of waiting
  // for the access token to expire. See docs/decision-log.md.
}

const ACCESS_TOKEN_TTL = "15m";
// §4.15 Putaran 7 — "platform.auth.refresh_token_ttl_days". This is the
// fallback used when no tenant-configured value is supplied: an unconfigured
// tenant, and every call site that does not pass `ttlDays` (tests, scripts).
const DEFAULT_REFRESH_TOKEN_TTL_DAYS = 7;

function accessSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET is not set");
  return secret;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, accessSecret(), { expiresIn: ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, accessSecret()) as AccessTokenPayload;
}

export function newRefreshTokenExpiry(ttlDays: number = DEFAULT_REFRESH_TOKEN_TTL_DAYS): Date {
  return new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
}
