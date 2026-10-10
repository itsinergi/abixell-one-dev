/**
 * WP-APR-03 — Segregation of Duties (SoD) engine.
 *
 * DEC-008/BR-013: forbidden duty combinations are tenant-governed data, and
 * the enforcement point is the database — the same posture as the
 * customer-scope exclusivity trigger (1788500000000). A rule names two role
 * CODES that may not be held by the same user in the same tenant. Rules are
 * stored canonicalized (LEAST/GREATEST) so one rule covers both orderings.
 *
 * Enforcement: a BEFORE INSERT OR UPDATE trigger on `user_role_assignments`
 * blocks any live assignment whose role code pairs with another live
 * assignment of the same user through a forbidden rule. Revoked/invalidated
 * rows grant nothing and are ignored (same semantics as the exclusivity
 * trigger). Because enforcement is a trigger, every write path — Admin
 * Console governed assignment, User provisioning, seed scripts — is covered
 * with no per-path wiring.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE sod_forbidden_rules (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      role_code_a   TEXT NOT NULL,
      role_code_b   TEXT NOT NULL,
      reason        TEXT NOT NULL,
      created_by    UUID NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (role_code_a <> role_code_b)
    );

    CREATE INDEX idx_sod_rules_tenant ON sod_forbidden_rules(tenant_id);
    -- UNIQUE on a canonicalized pair requires an expression index (a
    -- table-level UNIQUE constraint cannot name LEAST/GREATEST).
    CREATE UNIQUE INDEX ux_sod_rules_canonical_pair
      ON sod_forbidden_rules(tenant_id, LEAST(role_code_a, role_code_b), GREATEST(role_code_a, role_code_b));

    CREATE OR REPLACE FUNCTION enforce_sod_forbidden_pairs() RETURNS trigger AS $$
    DECLARE
      sod_violating_rule UUID;
      v_tenant_id UUID;
    BEGIN
      -- Only LIVE rows participate: a revoked or invalidated row grants
      -- nothing, so it cannot create a violation.
      IF NEW.scope_invalidated_at IS NOT NULL OR NEW.revoked_at IS NOT NULL THEN
        RETURN NEW;
      END IF;

      -- user_role_assignments carries no tenant_id column (tenant is held on
      -- roles/users); resolve it from the incoming role once.
      SELECT r.tenant_id INTO v_tenant_id
        FROM roles r
       WHERE r.id = NEW.role_id;
      IF v_tenant_id IS NULL THEN
        RETURN NEW;
      END IF;

      -- Resolve the incoming assignment's role code once.
      WITH incoming AS (
        SELECT r.code AS code
          FROM roles r
         WHERE r.id = NEW.role_id
           AND r.tenant_id = v_tenant_id
      ),
      -- Pair the incoming code with every OTHER live assignment of the user.
      violations AS (
        SELECT s.id AS rule_id, s.reason
          FROM incoming i
          JOIN sod_forbidden_rules s
            ON s.tenant_id = v_tenant_id
           AND i.code IN (s.role_code_a, s.role_code_b)
          JOIN user_role_assignments other
            ON other.user_id = NEW.user_id
           AND other.id <> NEW.id
           AND other.scope_invalidated_at IS NULL
           AND other.revoked_at IS NULL
          JOIN roles r2
            ON r2.id = other.role_id
           AND r2.tenant_id = v_tenant_id
         WHERE (i.code = s.role_code_a AND r2.code = s.role_code_b)
            OR (i.code = s.role_code_b AND r2.code = s.role_code_a)
         LIMIT 1
      )
      SELECT v.rule_id INTO sod_violating_rule
        FROM violations v;

      IF sod_violating_rule IS NOT NULL THEN
        -- Raise with a stable CONSTRAINT so the write path can map this to a
        -- 409, the same way the customer-scope exclusivity trigger does
        -- (ERRCODE 23514 + a named constraint). A bare RAISE EXCEPTION would
        -- surface as a 500 on every assignment path.
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          CONSTRAINT = 'user_role_assignments_sod_violation_check',
          MESSAGE = 'This role combination is forbidden by a Segregation of Duties rule in this tenant';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS user_role_assignments_sod_enforcement
      ON user_role_assignments;

    CREATE TRIGGER user_role_assignments_sod_enforcement
      BEFORE INSERT OR UPDATE ON user_role_assignments
      FOR EACH ROW
      EXECUTE FUNCTION enforce_sod_forbidden_pairs();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS user_role_assignments_sod_enforcement
      ON user_role_assignments;
    DROP FUNCTION IF EXISTS enforce_sod_forbidden_pairs();
    DROP TABLE IF EXISTS sod_forbidden_rules;
  `);
};
