/**
 * Phase 1C — Accounting Kernel — COA account hierarchy (WP-FIN-01)
 *
 * Adds self-referencing `parent_account_id` to `accounting_accounts` so a
 * Chart of Accounts can express tiered structure (DEC-001: tiered COA per
 * legal entity). Rules enforced here:
 *
 *   - `parent_account_id` references `accounting_accounts(id)`; nullable
 *     (top-level accounts have no parent).
 *   - The parent MUST belong to the same (tenant_id, legal_entity_id) — a
 *     hierarchy never crosses a legal entity boundary. Enforced by a CHECK
 *     implemented as a trigger (PostgreSQL CHECK cannot reference other rows).
 *   - Cycle prevention is enforced by the application layer (createAccount
 *     resolves the ancestor chain); the FK alone cannot prevent cycles
 *     between two existing rows, so a trigger also refuses a parent that is
 *     itself a descendant of the new child's subtree.
 *
 * Tenant discipline: direct `tenant_id` ownership already established in
 * Phase 1A migration 1792000000000; unchanged.
 *
 * POL-FIN-001 ACTIVE (Financial Control — Accounting Kernel).
 * POL-FIN-ADDENDUM-002 ACTIVE (Tenant discipline).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // 1. Self-referencing parent column ---------------------------------
  pgm.sql(`
    ALTER TABLE accounting_accounts
      ADD COLUMN IF NOT EXISTS parent_account_id uuid
        REFERENCES accounting_accounts(id) ON DELETE SET NULL;
  `);

  pgm.createIndex("accounting_accounts", ["parent_account_id"]);

  // Covers the same-entity parent lookup (trigger) and the recursive CTE's
  // root-detection EXISTS check (listAccountHierarchy) by id + tenant +
  // legal entity in one index.
  pgm.createIndex("accounting_accounts", ["id", "tenant_id", "legal_entity_id"], {
    name: "accounting_accounts_id_tenant_entity_idx",
  });

  // 2. Parent must share tenant + legal entity with the child ---------
  //    (cross-entity hierarchy is meaningless: GL aggregation is per entity)
  pgm.sql(`
    CREATE OR REPLACE FUNCTION check_parent_account_same_entity()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.parent_account_id IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM accounting_accounts
            WHERE id = NEW.parent_account_id
              AND tenant_id = NEW.tenant_id
              AND legal_entity_id = NEW.legal_entity_id
        ) THEN
          RAISE EXCEPTION
            'Parent account must belong to the same tenant and legal entity (parent_id=%)',
            NEW.parent_account_id
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    DROP TRIGGER IF EXISTS enforce_parent_account_same_entity ON accounting_accounts;
    CREATE TRIGGER enforce_parent_account_same_entity
      BEFORE INSERT OR UPDATE OF parent_account_id ON accounting_accounts
      FOR EACH ROW
      EXECUTE FUNCTION check_parent_account_same_entity();
  `);

  // 3. Cycle prevention: a parent may not be a descendant of the child -
  //    (walks the ancestor chain from the candidate parent; if it reaches
  //     the new row, the edge would close a cycle)
  pgm.sql(`
    CREATE OR REPLACE FUNCTION check_parent_account_no_cycle()
    RETURNS TRIGGER AS $$
    DECLARE
      walk_id uuid;
      depth int := 0;
    BEGIN
      IF NEW.parent_account_id IS NULL THEN
        RETURN NEW;
      END IF;
      IF NEW.parent_account_id = NEW.id THEN
        RAISE EXCEPTION 'Account cannot be its own parent'
          USING ERRCODE = 'check_violation';
      END IF;
      walk_id := NEW.parent_account_id;
      WHILE walk_id IS NOT NULL AND depth < 32 LOOP
        IF walk_id = NEW.id THEN
          RAISE EXCEPTION
            'Accounting account hierarchy cycle detected at parent_id=%',
            NEW.parent_account_id
            USING ERRCODE = 'check_violation';
        END IF;
        SELECT parent_account_id INTO walk_id
          FROM accounting_accounts
          WHERE id = walk_id
            AND tenant_id = NEW.tenant_id
            AND legal_entity_id = NEW.legal_entity_id;
        depth := depth + 1;
      END LOOP;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    DROP TRIGGER IF EXISTS enforce_parent_account_no_cycle ON accounting_accounts;
    CREATE TRIGGER enforce_parent_account_no_cycle
      BEFORE INSERT OR UPDATE OF parent_account_id ON accounting_accounts
      FOR EACH ROW
      EXECUTE FUNCTION check_parent_account_no_cycle();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS enforce_parent_account_no_cycle ON accounting_accounts;
    DROP TRIGGER IF EXISTS enforce_parent_account_same_entity ON accounting_accounts;
    DROP FUNCTION IF EXISTS check_parent_account_no_cycle();
    DROP FUNCTION IF EXISTS check_parent_account_same_entity();
  `);
  pgm.dropIndex("accounting_accounts", ["id", "tenant_id", "legal_entity_id"], {
    name: "accounting_accounts_id_tenant_entity_idx",
  });
  pgm.dropIndex("accounting_accounts", ["parent_account_id"]);
  pgm.sql(`
    ALTER TABLE accounting_accounts DROP COLUMN IF EXISTS parent_account_id;
  `);
};
