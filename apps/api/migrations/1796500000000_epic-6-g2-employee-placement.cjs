/**
 * Epic 6 Gelombang 2 — Employee Placement (Effective-Dated, Primary/Secondary)
 *
 * Reconciliation: Option B — BP-native canonical employee identity + read-only
 * Workforce Core compatibility projection. Legacy `employees` / `employee_assignments`
 * remain unchanged; no new code writes them.
 *
 * ── Schema changes ────────────────────────────────────────────────────────
 *
 *  1. Add `UNIQUE (tenant_id, id)` to `employee_profiles` to satisfy the
 *     platform-boundary validator's tenant-safe FK requirement.
 *
 *  2. Create `employee_placement_history`: immutable effective-dated placement
 *     records with tenant ownership, composite FKs, primary-overlap exclusion.
 *     Half-open `[effective_from, effective_to)` ranges. Exactly one primary
 *     per employee at any date (enforced by GiST exclusion); unlimited secondary
 *     placements per employee at any date.
 *
 * ── Ownership & delete semantics ──────────────────────────────────────────
 *
 * Both tables cascade from tenants: destroying a Tenant destroys all its
 * placements. Within a Tenant, placement rows are owned by their employee
 * profile; a hard-deleted employee profile loses its placements.
 *
 * Additive only: one constraint addition, one table, three indexes, one
 * exclusion constraint. Down() refuses if placement history exists.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // 1. Add UNIQUE (tenant_id, id) to employee_profiles for platform-boundary
  //    validator compliance and tenant-safe FK support.
  pgm.addConstraint("employee_profiles", "employee_profiles_tenant_id_key", {
    unique: ["tenant_id", "id"],
  });

  // 2. Enable GiST for exclusion constraints (no-op if already exists).
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS btree_gist;`);

  // 3. Create employee_placement_history table.
  pgm.createTable("employee_placement_history", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    employee_profile_id: { type: "uuid", notNull: true },
    placement_type: {
      type: "text",
      notNull: true,
      check: "placement_type IN ('primary', 'secondary')",
    },
    legal_entity_id: { type: "uuid", notNull: true },
    organization_unit_id: { type: "uuid", notNull: true },
    department_id: { type: "uuid" },
    effective_from: { type: "timestamptz", notNull: true },
    effective_to: { type: "timestamptz" },
    published_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    published_by: { type: "uuid" },
    recorded_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    reason: { type: "text", notNull: true },
    actor_user_id: { type: "uuid" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // 4. Add constraint: effective_to > effective_from (if effective_to is set).
  pgm.addConstraint("employee_placement_history", "employee_placement_history_range_check", {
    check: "effective_to IS NULL OR effective_to > effective_from",
  });

  // 4b. Reason must carry real content, not just whitespace.
  pgm.addConstraint("employee_placement_history", "employee_placement_history_reason_not_blank_check", {
    check: "length(btrim(reason)) > 0",
  });

  // 5. Composite FKs: tenant-safe ownership pattern.
  pgm.sql(`
    ALTER TABLE employee_placement_history
      ADD CONSTRAINT employee_placement_history_employee_fkey
      FOREIGN KEY (tenant_id, employee_profile_id)
      REFERENCES employee_profiles (tenant_id, id)
      ON DELETE CASCADE;

    ALTER TABLE employee_placement_history
      ADD CONSTRAINT employee_placement_history_legal_entity_fkey
      FOREIGN KEY (tenant_id, legal_entity_id)
      REFERENCES legal_entities (tenant_id, id)
      ON DELETE RESTRICT;

    ALTER TABLE employee_placement_history
      ADD CONSTRAINT employee_placement_history_organization_unit_fkey
      FOREIGN KEY (tenant_id, organization_unit_id)
      REFERENCES organization_units (tenant_id, id)
      ON DELETE RESTRICT;

    ALTER TABLE employee_placement_history
      ADD CONSTRAINT employee_placement_history_department_fkey
      FOREIGN KEY (tenant_id, department_id)
      REFERENCES departments (tenant_id, id)
      ON DELETE SET NULL;
  `);

  // 6. GiST exclusion constraint: no overlapping primary placements per employee.
  //    Permit adjacent ranges and unlimited secondary placements.
  pgm.sql(`
    ALTER TABLE employee_placement_history
      ADD CONSTRAINT employee_placement_history_primary_no_overlap
      EXCLUDE USING gist (
        tenant_id WITH =,
        employee_profile_id WITH =,
        placement_type WITH =,
        tstzrange(effective_from, effective_to, '[)') WITH &&
      )
      WHERE (placement_type = 'primary');
  `);

  // 7. Indexes for common queries.
  pgm.createIndex("employee_placement_history", ["tenant_id", "employee_profile_id"], {
    name: "idx_employee_placement_history_tenant_employee",
  });
  pgm.createIndex("employee_placement_history", ["tenant_id", "employee_profile_id", "placement_type"], {
    name: "idx_employee_placement_history_tenant_employee_type",
  });
  pgm.createIndex("employee_placement_history", ["tenant_id", "employee_profile_id", "effective_from"], {
    name: "idx_employee_placement_history_tenant_employee_effective",
  });
  pgm.createIndex(
    "employee_placement_history",
    [{ name: "tenant_id" }, { name: "employee_profile_id" }, { name: "placement_type" }, { name: "effective_to" }],
    {
      name: "idx_employee_placement_history_active",
      where: "effective_to IS NULL",
    },
  );

};

exports.down = (pgm) => {
  pgm.sql(`
    -- Refuse to roll back while placement history exists. Placement records
    -- are immutable and historical; rolling back this migration would silently
    -- abandon them.
    DO $$
    DECLARE
      remaining_placements integer;
    BEGIN
      SELECT COUNT(*)::integer
        INTO remaining_placements
        FROM employee_placement_history;

      IF remaining_placements > 0 THEN
        RAISE EXCEPTION
          'Cannot roll back Epic 6 G2 — % employee placement records exist',
          remaining_placements;
      END IF;
    END $$;

  `);
  pgm.dropTable("employee_placement_history", { ifExists: true });
  pgm.dropConstraint("employee_profiles", "employee_profiles_tenant_id_key", { ifExists: true });
};
