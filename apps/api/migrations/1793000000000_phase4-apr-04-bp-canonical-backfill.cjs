/**
 * WP-APR-04 — Business Partner canonical consolidation (backfill).
 *
 * DEC-006 approved the Single-canonical model: every real-world party is a
 * `business_partners` row with roles. Legacy fragmented tables (`suppliers`
 * from Supply Chain Core, `customers` from Customer Experience) remain in
 * place — this migration only (a) creates the link table that maps each
 * legacy row to its canonical BP, and (b) backfills one canonical BP +
 * `bp_roles` row per legacy row that does not yet have a link.
 *
 * Physical retirement of the legacy tables is a Phase 5 work package; until
 * then writes stay in the legacy tables and reads may resolve through BP.
 *
 * Ownership: `bp_legacy_links.created_by_backfill` records whether the BP was
 * CREATED by this backfill or merely matched an existing BP by (code, name);
 * `role_created_by_backfill` records whether the `bp_roles` row was inserted
 * by this backfill or already existed. `down` removes only what the backfill
 * created — a BP the link matched onto, and any role that predates the
 * backfill, are left untouched.
 *
 * Order matters. For each legacy table: link rows that already match an
 * existing BP (code + name) first, then create a BP for the remainder, then
 * link the created ones. Creating before matching would mint an orphan BP
 * (a fallback code) even when a same-code BP already existed.
 *
 * Code strategy: BP code = legacy `code` unless a BP with that code already
 * exists, then `code~<legacy_id-prefix8>`. Legacy codes are UNIQUE per tenant
 * in both source tables, so both forms are unique per tenant by construction.
 *
 * Idempotency: every INSERT filters on `bp_legacy_links` membership, so
 * re-running creates nothing. UNIQUE(tenant, table, legacy_id) makes a legacy
 * row linkable to at most one BP.
 */
exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public'
           AND t.relname = 'business_partners'
           AND c.contype = 'u'
           AND c.conkey = ARRAY[
             (SELECT attnum FROM pg_attribute WHERE attrelid = t.oid AND attname = 'tenant_id'),
             (SELECT attnum FROM pg_attribute WHERE attrelid = t.oid AND attname = 'id')
           ]::smallint[]
      ) THEN
        ALTER TABLE business_partners
          ADD CONSTRAINT business_partners_tenant_id_id_unique UNIQUE (tenant_id, id);
      END IF;
    END $$;
  `);

  pgm.sql(`
    CREATE TABLE bp_legacy_links (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      legacy_table  TEXT NOT NULL
        CHECK (legacy_table IN ('suppliers', 'customers')),
      legacy_id     UUID NOT NULL,
      business_partner_id UUID NOT NULL,
      created_by_backfill BOOLEAN NOT NULL DEFAULT false,
      role_created_by_backfill BOOLEAN NOT NULL DEFAULT false,
      linked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, legacy_table, legacy_id),
      UNIQUE (tenant_id, business_partner_id, legacy_table),
      FOREIGN KEY (tenant_id, business_partner_id)
        REFERENCES business_partners(tenant_id, id) ON DELETE CASCADE
    );

    CREATE INDEX idx_bp_legacy_links_bp ON bp_legacy_links(business_partner_id);
  `);

  // 1. Link suppliers already represented by an existing BP (same code+name).
  pgm.sql(`
    INSERT INTO bp_legacy_links
      (tenant_id, legacy_table, legacy_id, business_partner_id, created_by_backfill)
    SELECT s.tenant_id, 'suppliers', s.id, b.id, false
    FROM suppliers s
    JOIN business_partners b
      ON b.tenant_id = s.tenant_id AND b.code = s.code AND b.name = s.name
    WHERE NOT EXISTS (
      SELECT 1 FROM bp_legacy_links l
      WHERE l.tenant_id = s.tenant_id
        AND l.legacy_table = 'suppliers'
        AND l.legacy_id = s.id
    );
  `);

  // 2. Create a canonical BP for every supplier still unlinked.
  //
  //    The `tenants` join drops legacy rows whose tenant no longer exists:
  //    `business_partners.tenant_id` carries a FK to `tenants`, so copying an
  //    orphaned supplier would abort the whole migration. Orphans can exist in
  //    a database that accumulated rows before the legacy table gained its
  //    tenant FK, or through test fixtures that were torn down incompletely.
  pgm.sql(`
    INSERT INTO business_partners (tenant_id, code, bp_type, name, lifecycle_status, is_active)
    SELECT s.tenant_id,
           CASE
             WHEN EXISTS (SELECT 1 FROM business_partners b
                          WHERE b.tenant_id = s.tenant_id AND b.code = s.code)
             THEN s.code || '~' || substring(s.id::text, 1, 8)
             ELSE s.code
           END,
           'organization', s.name,
           CASE WHEN s.is_active THEN 'active' ELSE 'inactive' END,
           s.is_active
    FROM suppliers s
    JOIN tenants t ON t.id = s.tenant_id
    WHERE NOT EXISTS (
      SELECT 1 FROM bp_legacy_links l
      WHERE l.tenant_id = s.tenant_id
        AND l.legacy_table = 'suppliers'
        AND l.legacy_id = s.id
    );
  `);

  // 3. Link the BPs just created for suppliers.
  pgm.sql(`
    INSERT INTO bp_legacy_links
      (tenant_id, legacy_table, legacy_id, business_partner_id, created_by_backfill)
    SELECT s.tenant_id, 'suppliers', s.id, b.id, true
    FROM suppliers s
    JOIN business_partners b
      ON b.tenant_id = s.tenant_id
     AND (b.code = s.code OR b.code = s.code || '~' || substring(s.id::text, 1, 8))
     AND b.name = s.name
    WHERE NOT EXISTS (
      SELECT 1 FROM bp_legacy_links l
      WHERE l.tenant_id = s.tenant_id
        AND l.legacy_table = 'suppliers'
        AND l.legacy_id = s.id
    );
  `);

  // 4. Attach the 'vendor' role to every linked supplier BP that lacks it,
  //    and stamp that the role was created by this backfill so `down` can
  //    remove only those roles (a BP matched onto an existing BP may already
  //    carry a 'vendor' role that predates the backfill — leave it alone).
  pgm.sql(`
    WITH created AS (
      INSERT INTO bp_roles (tenant_id, business_partner_id, role_type)
      SELECT l.tenant_id, l.business_partner_id, 'vendor'
      FROM bp_legacy_links l
      WHERE l.legacy_table = 'suppliers'
      ON CONFLICT DO NOTHING
      RETURNING tenant_id, business_partner_id
    )
    UPDATE bp_legacy_links l
       SET role_created_by_backfill = true
      FROM created c
     WHERE l.legacy_table = 'suppliers'
       AND l.tenant_id = c.tenant_id
       AND l.business_partner_id = c.business_partner_id;
  `);

  // 5. Customers: same three steps (soft-deleted rows are skipped).
  pgm.sql(`
    INSERT INTO bp_legacy_links
      (tenant_id, legacy_table, legacy_id, business_partner_id, created_by_backfill)
    SELECT c.tenant_id, 'customers', c.id, b.id, false
    FROM customers c
    JOIN business_partners b
      ON b.tenant_id = c.tenant_id AND b.code = c.code AND b.name = c.name
    WHERE c.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM bp_legacy_links l
      WHERE l.tenant_id = c.tenant_id
        AND l.legacy_table = 'customers'
        AND l.legacy_id = c.id
    );
  `);

  pgm.sql(`
    INSERT INTO business_partners (tenant_id, code, bp_type, name, lifecycle_status, is_active)
    SELECT c.tenant_id,
           CASE
             WHEN EXISTS (SELECT 1 FROM business_partners b
                          WHERE b.tenant_id = c.tenant_id AND b.code = c.code)
             THEN c.code || '~' || substring(c.id::text, 1, 8)
             ELSE c.code
           END,
           'organization', c.name,
           CASE WHEN c.status = 'active' THEN 'active' ELSE 'inactive' END,
           c.status = 'active'
    FROM customers c
    JOIN tenants t ON t.id = c.tenant_id
    WHERE c.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM bp_legacy_links l
      WHERE l.tenant_id = c.tenant_id
        AND l.legacy_table = 'customers'
        AND l.legacy_id = c.id
    );
  `);

  pgm.sql(`
    INSERT INTO bp_legacy_links
      (tenant_id, legacy_table, legacy_id, business_partner_id, created_by_backfill)
    SELECT c.tenant_id, 'customers', c.id, b.id, true
    FROM customers c
    JOIN business_partners b
      ON b.tenant_id = c.tenant_id
     AND (b.code = c.code OR b.code = c.code || '~' || substring(c.id::text, 1, 8))
     AND b.name = c.name
    WHERE c.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM bp_legacy_links l
      WHERE l.tenant_id = c.tenant_id
        AND l.legacy_table = 'customers'
        AND l.legacy_id = c.id
    );
  `);

  pgm.sql(`
    WITH created AS (
      INSERT INTO bp_roles (tenant_id, business_partner_id, role_type)
      SELECT l.tenant_id, l.business_partner_id, 'customer'
      FROM bp_legacy_links l
      WHERE l.legacy_table = 'customers'
      ON CONFLICT DO NOTHING
      RETURNING tenant_id, business_partner_id
    )
    UPDATE bp_legacy_links l
       SET role_created_by_backfill = true
      FROM created c
     WHERE l.legacy_table = 'customers'
       AND l.tenant_id = c.tenant_id
       AND l.business_partner_id = c.business_partner_id;
  `);
};

exports.down = (pgm) => {
  // Remove only the roles and BPs the backfill itself created.
  pgm.sql(`
    DELETE FROM bp_roles r
    USING bp_legacy_links l
    WHERE l.role_created_by_backfill
      AND r.tenant_id = l.tenant_id
      AND r.business_partner_id = l.business_partner_id
      AND r.role_type = CASE l.legacy_table
        WHEN 'suppliers' THEN 'vendor'
        WHEN 'customers' THEN 'customer'
      END;
  `);
  pgm.sql(`
    DELETE FROM business_partners b
    USING bp_legacy_links l
    WHERE l.created_by_backfill
      AND b.tenant_id = l.tenant_id
      AND b.id = l.business_partner_id;
  `);
  pgm.dropTable("bp_legacy_links");
};