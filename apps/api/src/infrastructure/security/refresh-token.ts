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

export async function issueRefreshToken(pool: Pool, userId: string): Promise<string> {
  const token = generateOpaqueToken();
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, hashToken(token), newRefreshTokenExpiry()],
  );
  return token;
}

export async function consumeRefreshToken(
  pool: Pool,
  token: string,
): Promise<{ userId: string } | null> {
  const result = await pool.query(
    `SELECT id, user_id FROM refresh_tokens
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [hashToken(token)],
  );
  if (!result.rows[0]) return null;

  // Rotate: revoke the consumed token so it cannot be replayed.
  await pool.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [
    result.rows[0].id,
  ]);

  return { userId: result.rows[0].user_id };
}

/** Explicit logout (Checkpoint 0F): revoke a refresh token on request
 * rather than waiting for it to be consumed/rotated or to expire.
 * Idempotent by design — revoking an already-revoked or unknown token is
 * a silent no-op, since logout should never leak whether a token was
 * valid (same principle as login's generic "invalid credentials"). */
export async function revokeRefreshToken(pool: Pool, token: string): Promise<void> {
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(token)],
  );
}
