/**
 * Checkpoint 0F: Phase 0 Stabilization.
 *
 * Purely additive — no existing column, table, or constraint from
 * 0A-0E is altered or dropped. Three independent, small schema changes,
 * each resolving a specific gap flagged in decision-log.md/
 * implementation-notes.md across prior checkpoints:
 *
 * --- 1. Inbound Integration webhook idempotency -----------------------
 * A webhook sender may legitimately retry a delivery (network timeout,
 * no 2xx seen, etc.) — without a dedupe key, a retried delivery would
 * publish a second identical Domain Event and a second log entry.
 * `idempotency_key` is nullable and OPTIONAL (a sender that doesn't send
 * one gets the pre-0F behavior, logged every time); when present, a
 * partial unique index makes a duplicate delivery to the SAME Endpoint
 * with the SAME key a no-op at the database level, not just an
 * application-level check that could race.
 *
 * --- 2. Production permission migration (ADR-0010) ---------------------
 * Checkpoints 0C, 0D, and 0E each hit the same gap: a new permission
 * code added by a Product Core migration does not retroactively appear
 * on any existing Role's grants — the demo tenant worked around this by
 * deleting and reseeding, explicitly documented as "not a production
 * migration strategy". `roles.is_full_access` marks a Role (typically a
 * platform Administrator role) whose intent is "grant every permission
 * that exists" rather than a hand-picked subset; `scripts/
 * sync-role-permissions.ts` (new in 0F) idempotently grants any
 * permission such a Role is missing, additive-only, safe to run
 * repeatedly against a live production tenant. See
 * docs/adr/0010-production-permission-migration.md.
 *
 * --- 3. Refresh token revocation trace -----------------------------
 * No schema change needed here — `revoked_at` already existed since 0B;
 * `revokeRefreshToken` (new in 0F, backing `POST /auth/logout`) reuses
 * the existing column. Listed here only for completeness of this
 * migration's header, not because it touches the schema.
 */

exports.up = (pgm) => {
  // --- 1. Integration webhook idempotency ---------------------------------
  pgm.addColumns("integration_event_log", {
    idempotency_key: { type: "text", notNull: false },
  });
  pgm.createIndex("integration_event_log", ["integration_endpoint_id", "idempotency_key"], {
    name: "integration_event_log_endpoint_idempotency_key_uidx",
    unique: true,
    where: "idempotency_key IS NOT NULL AND direction = 'inbound'",
  });

  // --- 2. Production permission migration (ADR-0010) ----------------------
  pgm.addColumns("roles", {
    is_full_access: { type: "boolean", notNull: true, default: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("roles", ["is_full_access"]);
  pgm.dropIndex("integration_event_log", [], {
    name: "integration_event_log_endpoint_idempotency_key_uidx",
  });
  pgm.dropColumns("integration_event_log", ["idempotency_key"]);
};
