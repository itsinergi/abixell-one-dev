/**
 * Epic 1 Wave 1 (CORE-ROADMAP.md §4.1 A/B) — server-side security context.
 *
 * The active Role belongs to this table, not to the JWT. The access token only
 * carries `sessionId`; authentication resolves this row on every request.
 * `active_assignment_id` is nullable by design: a user with no currently
 * effective assignment may still reach `/me`, while permissioned routes fail
 * closed with 403 until an assignment exists.
 *
 * `ON DELETE SET NULL` is deliberate. Epic 4 may revoke an assignment while
 * sessions still exist. The next request must become an actor with no active
 * assignment, not fail with a foreign-key error or retain stale authority.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("sessions", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "CASCADE",
    },
    tenant_id: {
      type: "uuid",
      notNull: true,
      references: "tenants",
      onDelete: "CASCADE",
    },
    active_assignment_id: {
      type: "uuid",
      references: "user_role_assignments",
      onDelete: "SET NULL",
    },
    active_role_id: {
      type: "uuid",
      references: "roles",
      onDelete: "SET NULL",
    },
    organization_unit_id: {
      type: "uuid",
      references: "organization_units",
      onDelete: "SET NULL",
    },
    web_session: { type: "text" },
    remote_addr: { type: "text" },
    login_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    last_seen_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    revoked_at: { type: "timestamptz" },
    processed: {
      type: "boolean",
      notNull: true,
      default: false,
    },
  });

  pgm.createIndex("sessions", "user_id", {
    name: "sessions_active_user_idx",
    where: "revoked_at IS NULL",
  });
  pgm.createIndex("sessions", ["tenant_id", "active_assignment_id"]);

  // A refresh token belongs to the login that minted it, so refresh and
  // logout can reach the session: refresh must keep a session alive only
  // while the session is actually alive, and logout must revoke the session
  // alongside the token or a sibling token from the same login would keep
  // re-minting access tokens after sign-out. Nullable because the column is
  // added at the same moment sessions start existing — no row predates them
  // except test fixtures, which stay session-less and fail the refresh-time
  // liveness check by design (hard cutover, §4.1 F).
  pgm.addColumn("refresh_tokens", {
    session_id: {
      type: "uuid",
      references: "sessions",
      onDelete: "CASCADE",
    },
  });
  pgm.createIndex("refresh_tokens", "session_id");
};

exports.down = (pgm) => {
  // The column goes first: `sessions` cannot be dropped while a foreign key
  // from `refresh_tokens` still points at it.
  pgm.dropIndex("refresh_tokens", "session_id");
  pgm.dropColumn("refresh_tokens", "session_id");
  pgm.dropTable("sessions");
};
