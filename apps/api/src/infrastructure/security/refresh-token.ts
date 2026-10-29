import { randomBytes, createHash } from "node:crypto";
import type { Pool } from "pg";
import { newRefreshTokenExpiry } from "./jwt.js";

/** Opaque refresh token: a random value, only its SHA-256 hash is stored. */
export function generateOpaqueToken(): string {
  return randomBytes(48).toString("hex");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueRefreshToken(
  pool: Pool,
  userId: string,
  sessionId?: string,
  ttlDays?: number,
): Promise<string> {
  const token = generateOpaqueToken();
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, session_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, sessionId ?? null, hashToken(token), newRefreshTokenExpiry(ttlDays)],
  );
  return token;
}

export async function consumeRefreshToken(
  pool: Pool,
  token: string,
): Promise<{ userId: string; sessionId: string | null } | null> {
  const result = await pool.query<{ id: string; user_id: string; session_id: string | null }>(
    `SELECT id, user_id, session_id FROM refresh_tokens
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [hashToken(token)],
  );
  if (!result.rows[0]) return null;

  // Rotate: revoke the consumed token so it cannot be replayed.
  await pool.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [
    result.rows[0].id,
  ]);

  return { userId: result.rows[0].user_id, sessionId: result.rows[0].session_id };
}

/** Explicit logout (Checkpoint 0F): revoke a refresh token on request
 * rather than waiting for it to be consumed/rotated or to expire.
 * Idempotent by design — revoking an already-revoked or unknown token is
 * a silent no-op, since logout should never leak whether a token was
 * valid (same principle as login's generic "invalid credentials").
 *
 * Returns the token's session id when the row carried one, so logout can
 * revoke the session too (Epic 1): otherwise a sibling refresh token from
 * the same login would keep re-minting access tokens after sign-out. */
export async function revokeRefreshToken(
  pool: Pool,
  token: string,
): Promise<{ sessionId: string | null } | null> {
  const result = await pool.query<{ session_id: string | null }>(
    `UPDATE refresh_tokens SET revoked_at = now()
      WHERE token_hash = $1 AND revoked_at IS NULL
      RETURNING session_id`,
    [hashToken(token)],
  );
  const row = result.rows[0];
  return row ? { sessionId: row.session_id } : null;
}

/** Inactive-user lifecycle hardening (Phase 11F): revoke every still-active
 * refresh token belonging to a User in one statement. Called the moment an
 * inactive/deleted account is discovered at refresh time, so a refresh
 * token minted before deactivation cannot mint further access tokens once
 * the deactivation is observed — no per-token replay window survives it. */
export async function revokeAllRefreshTokensForUser(pool: Pool, userId: string): Promise<void> {
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
}
