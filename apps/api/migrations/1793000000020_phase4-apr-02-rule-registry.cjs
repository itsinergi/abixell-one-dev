/**
 * WP-APR-02 — Central Rule Registry (DEC-008/BR-013).
 *
 * One governed, versioned store for business rules that other modules
 * currently keep in per-module tables. Supersede-not-update (BR-013): a
 * version is immutable; changing a rule means inserting a new version with
 * a later valid_from, then superseding the old one.
 *
 * WP-FIN-05 `posting_rules` keeps its operational role; the kernel consults
 * the registry first (rule_key 'finance.posting_rule', payload = the
 * accounting formula) and falls back to the posting-rules table, so existing
 * tenants and tests keep working while new rules can be registered centrally.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE rule_registry_entries (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      rule_key    TEXT NOT NULL,
      version     INTEGER NOT NULL,
      payload     JSONB NOT NULL,
      status      TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'superseded', 'retired')),
      valid_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
      valid_to    TIMESTAMPTZ NULL,
      module_code TEXT NULL,
      created_by  UUID NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by  UUID NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, rule_key, version)
    );

    CREATE INDEX idx_rule_registry_tenant_key ON rule_registry_entries(tenant_id, rule_key);
    CREATE INDEX idx_rule_registry_active ON rule_registry_entries(tenant_id, rule_key, status)
      WHERE status = 'active';

    CREATE OR REPLACE FUNCTION rule_registry_no_activate_overlap() RETURNS trigger AS $$
    BEGIN
      -- At most one ACTIVE version per (tenant, key): activating a version
      -- supersedes the currently active one (supersede-not-update).
      IF NEW.status = 'active' THEN
        UPDATE rule_registry_entries
           SET status = 'superseded',
               valid_to = now(),
               updated_by = COALESCE(NEW.updated_by, NEW.created_by),
               updated_at = now()
         WHERE tenant_id = NEW.tenant_id
           AND rule_key = NEW.rule_key
           AND status = 'active'
           AND id <> NEW.id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER rule_registry_supersede_on_activate
      BEFORE INSERT OR UPDATE ON rule_registry_entries
      FOR EACH ROW
      EXECUTE FUNCTION rule_registry_no_activate_overlap();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS rule_registry_supersede_on_activate
      ON rule_registry_entries;
    DROP FUNCTION IF EXISTS rule_registry_no_activate_overlap();
    DROP TABLE IF EXISTS rule_registry_entries;
  `);
};
