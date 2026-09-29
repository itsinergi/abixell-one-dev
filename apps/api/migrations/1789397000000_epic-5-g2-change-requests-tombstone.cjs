/**
 * Epic 5 Gelombang 2 (§4.5 steps 11 and 13) — Change requests, tombstone
 * metadata and the reference-check registry.
 *
 * G0 contract `docs/plans/epic-5-g0-contract.md` migration M9 (stamp re-assigned
 * to 1789397000000 by the 2026-09-29 re-stamp commit), §3 (ownership inventory),
 * §13 Q7 (change-request status values) and Q8 (registry from the inventory).
 *
 * ── 1. Change request ─────────────────────────────────────────────────────
 *
 * §4.5 principle 12: "Proposal bukan publish. Admin Tenant dapat menyusun draft
 * perubahan dalam batasnya; hanya Super Admin dapat menerbitkan perubahan
 * struktur dan Legal Entity yang mengubah data authority/hierarchy." Putaran 5
 * fixes the payload: "Draft change request berisi before/after, effective date,
 * reason, dan proposer. Super Admin review lalu publish atau reject." Every one
 * of those is a column here, and `before_state` / `after_state` are jsonb so the
 * stored proposal is what the reviewer actually saw, not a re-derivation from
 * current data that may have moved on.
 *
 * Q7 asks whether the status set is `draft/published/rejected` or includes
 * `pending_review`. Decision: it includes BOTH `pending_review` and `cancelled`.
 * The reason is the actor split the roadmap locks: a draft is the Admin Tenant's
 * own scratch space (editable, deletable), while `pending_review` is the claim
 * "this is what I am asking the Super Admin to publish" — collapsing them would
 * make `draft` mean two different things and would let a proposer silently edit
 * a request that is already under review. `cancelled` is the proposer withdrawing
 * before review; only `published` and `rejected` are terminal *review* outcomes.
 *
 * ── 2. Tombstone metadata (§4.5 D, step 13) ───────────────────────────────
 *
 * `organization_units` gains `tombstoned_at`, `tombstoned_by` and
 * `tombstone_reason`. Putaran 4: "Setelah inactive, Delete oleh Super Admin
 * mengubah Organization Unit menjadi tombstone `deleted`; transaksi tetap
 * menunjuk unit historis tersebut." The row therefore stays readable — the
 * minimum identity survives — and these three columns are what a historical read
 * uses to explain WHY it is gone, WHEN and BY WHOM. `replacement_organization_unit_id`
 * (G1) carries the optional replacement from Putaran 4.
 *
 * ── 3. Reference-check registry (§4.5 step 13, G0 §3 + §13 Q8) ────────────
 *
 * Roadmap open item #8 says physical-delete eligibility is "dipastikan saat
 * Gelombang 2 dari schema/foreign-key inventory, bukan diasumsikan sekarang".
 * This is that inventory, as a table: `entity_reference_registry` lists every
 * column that references an Organization Unit or a Legal Entity, and
 * `entity_reference_census(kind, id)` counts the rows that actually reference a
 * given entity. The delete path asks the census, so "physical delete only when
 * nothing references it" (§4.5 principle 6) is a measurement, not a promise.
 *
 * The registry is GENERATED from `pg_constraint` rather than hand-written, and
 * `entity_reference_registry_refresh()` regenerates it on demand. A hand-typed
 * list of 19 foreign keys would be wrong the first time anyone adds a column,
 * and silently wrong is worse than absent: the refresher is the fix for both.
 *
 * Three owner-side tables are deliberately EXCLUDED from the registry:
 * `legal_entity_addresses`, `organization_unit_hierarchy_history` and
 * `organization_unit_change_requests`. They are the entity's own content — an
 * address belongs to its Legal Entity, a history row is the unit's own
 * structural record, a change request is the unit's own proposal — so their rows
 * die with the entity they describe (their FKs cascade) and they are not
 * evidence that anybody else used it. Counting them would make the census
 * permanently non-zero (the parity snapshot guarantees every unit has at least
 * one history row) and would turn "physical delete when never referenced" into
 * "never delete anything", which is not what §4.5 says.
 *
 * `audit_log` is excluded for the same reason with a different argument:
 * §4.5 principle 10 makes audit append-only history that must survive, and
 * every entity has an audit row from the moment it is created. Audit explains a
 * tombstone; it does not block one.
 *
 * Additive only: two tables, four columns, one generated registry, two functions.
 */

exports.shorthands = undefined;

const CHANGE_REQUEST_STATUSES = "'draft','pending_review','published','rejected','cancelled'";
const CHANGE_REQUEST_ACTIONS = "'move','tombstone'";

/** Owner-side tables whose rows are the entity's own content, not a reference
 * by a third party. See the header. */
const OWNER_TABLES = `('legal_entity_addresses','organization_unit_hierarchy_history','organization_unit_change_requests')`;

exports.up = (pgm) => {
  // ── 1. Change request ───────────────────────────────────────────────────
  pgm.createTable("organization_unit_change_requests", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    organization_unit_id: { type: "uuid", notNull: true },
    requested_action: { type: "text", notNull: true },
    proposed_parent_organization_unit_id: { type: "uuid" },
    requested_replacement_organization_unit_id: { type: "uuid" },
    requested_effective_from: { type: "timestamptz", notNull: true },
    reason: { type: "text", notNull: true },
    status: { type: "text", notNull: true, default: "draft" },
    before_state: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    after_state: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    proposed_by_user_id: { type: "uuid", notNull: true },
    reviewed_by_user_id: { type: "uuid" },
    reviewed_at: { type: "timestamptz" },
    review_reason: { type: "text" },
    published_at: { type: "timestamptz" },
    history_id: { type: "uuid" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("organization_unit_change_requests", "organization_unit_change_requests_action_check", {
    check: `requested_action IN (${CHANGE_REQUEST_ACTIONS})`,
  });
  pgm.addConstraint("organization_unit_change_requests", "organization_unit_change_requests_status_check", {
    check: `status IN (${CHANGE_REQUEST_STATUSES})`,
  });
  // A rejected or published request carries its review verdict; a pending one
  // has not been reviewed yet, so the two fields move together.
  pgm.addConstraint("organization_unit_change_requests", "organization_unit_change_requests_review_check", {
    check:
      "(status IN ('draft','pending_review','cancelled') AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL) " +
      "OR (status IN ('published','rejected') AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)",
  });

  pgm.sql(`
    ALTER TABLE organization_unit_change_requests
      ADD CONSTRAINT organization_unit_change_requests_unit_fkey
      FOREIGN KEY (tenant_id, organization_unit_id)
      REFERENCES organization_units (tenant_id, id)
      ON DELETE CASCADE;

    ALTER TABLE organization_unit_change_requests
      ADD CONSTRAINT organization_unit_change_requests_parent_fkey
      FOREIGN KEY (tenant_id, proposed_parent_organization_unit_id)
      REFERENCES organization_units (tenant_id, id)
      ON DELETE SET NULL (proposed_parent_organization_unit_id);

    ALTER TABLE organization_unit_change_requests
      ADD CONSTRAINT organization_unit_change_requests_replacement_fkey
      FOREIGN KEY (tenant_id, requested_replacement_organization_unit_id)
      REFERENCES organization_units (tenant_id, id)
      ON DELETE SET NULL (requested_replacement_organization_unit_id);
  `);

  pgm.createIndex("organization_unit_change_requests", ["tenant_id", "status"], {
    name: "organization_unit_change_requests_tenant_status_idx",
  });
  pgm.createIndex("organization_unit_change_requests", ["organization_unit_id", "created_at"], {
    name: "organization_unit_change_requests_unit_created_idx",
  });

  // ── 2. Tombstone metadata ───────────────────────────────────────────────
  pgm.addColumns("organization_units", {
    tombstoned_at: { type: "timestamptz" },
    tombstoned_by: { type: "uuid" },
    tombstone_reason: { type: "text" },
  });

  // ── 3. Reference-check registry ─────────────────────────────────────────
  pgm.createTable("entity_reference_registry", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    entity_type: { type: "text", notNull: true },
    referencing_table: { type: "text", notNull: true },
    referencing_column: { type: "text", notNull: true },
    referenced_table: { type: "text", notNull: true },
    reference_kind: { type: "text", notNull: true, default: "fk" },
    blocks_physical_delete: { type: "boolean", notNull: true, default: true },
    note: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("entity_reference_registry", "entity_reference_registry_entity_type_check", {
    check: "entity_type IN ('organization_unit','legal_entity')",
  });
  pgm.addConstraint("entity_reference_registry", "entity_reference_registry_unique", {
    unique: ["entity_type", "referencing_table", "referencing_column"],
  });

  pgm.sql(`
    CREATE OR REPLACE FUNCTION entity_reference_registry_refresh()
    RETURNS integer AS $fn$
    DECLARE
      inserted integer;
    BEGIN
      INSERT INTO entity_reference_registry
        (entity_type, referencing_table, referencing_column, referenced_table,
         reference_kind, blocks_physical_delete, note)
      SELECT CASE rc.relname WHEN 'legal_entities' THEN 'legal_entity' ELSE 'organization_unit' END,
             tc.relname,
             a.attname,
             rc.relname,
             'fk',
             true,
             'generated from pg_constraint by entity_reference_registry_refresh()'
        FROM pg_constraint c
        JOIN pg_class tc ON tc.oid = c.conrelid
        JOIN pg_class rc ON rc.oid = c.confrelid
        JOIN generate_subscripts(c.conkey, 1) AS i ON true
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[i]
        JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[i]
       WHERE c.contype = 'f'
         AND rc.relname IN ('organization_units','legal_entities')
         AND ra.attname = 'id'
         AND tc.relname NOT IN ${OWNER_TABLES}
      ON CONFLICT (entity_type, referencing_table, referencing_column) DO NOTHING;

      GET DIAGNOSTICS inserted = ROW_COUNT;
      RETURN inserted;
    END;
    $fn$ LANGUAGE plpgsql;

    SELECT entity_reference_registry_refresh();

    -- One measurement per entity: the rows that point at it. An empty array is
    -- "nothing references this", the only condition under which §4.5 principle 6
    -- allows a physical delete.
    CREATE OR REPLACE FUNCTION entity_reference_census(p_entity_type text, p_entity_id uuid)
    RETURNS jsonb AS $fn$
    DECLARE
      r record;
      hits bigint;
      detail jsonb := '[]'::jsonb;
    BEGIN
      FOR r IN
        SELECT referencing_table, referencing_column
          FROM entity_reference_registry
         WHERE entity_type = p_entity_type
           AND blocks_physical_delete = true
         ORDER BY referencing_table, referencing_column
      LOOP
        EXECUTE format('SELECT count(*) FROM %I WHERE %I = $1', r.referencing_table, r.referencing_column)
          INTO hits USING p_entity_id;
        IF hits > 0 THEN
          detail := detail || jsonb_build_object(
            'table', r.referencing_table, 'column', r.referencing_column, 'count', hits);
        END IF;
      END LOOP;
      RETURN detail;
    END;
    $fn$ LANGUAGE plpgsql STABLE;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS entity_reference_census(text, uuid);
    DROP FUNCTION IF EXISTS entity_reference_registry_refresh();
    DROP TABLE IF EXISTS entity_reference_registry;
  `);
  pgm.dropColumns("organization_units", [
    "tombstone_reason",
    "tombstoned_by",
    "tombstoned_at",
  ]);
  pgm.dropTable("organization_unit_change_requests");
};
