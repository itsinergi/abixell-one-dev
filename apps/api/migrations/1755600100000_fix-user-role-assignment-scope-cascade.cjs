/**
 * Fix: user_role_assignments.scope_organization_unit_id had no ON DELETE
 * behavior, so cascading a full Tenant deletion (Tenant -> Organization
 * Units) failed with a foreign key violation because the assignment row
 * still pointed at the unit. Found while adding automated test cleanup
 * for Checkpoint 0B's integration test (docs/decision-log.md).
 *
 * Deleting an Organization Unit that still has scoped Role assignments
 * pointing at it is not a normal Phase 0 flow (there is no "delete
 * Organization Unit" endpoint yet) — this only matters for the
 * whole-Tenant cascade case (deprovisioning a client), where cascading
 * the assignment away too is the correct behavior.
 */

exports.up = (pgm) => {
  pgm.dropConstraint(
    "user_role_assignments",
    "user_role_assignments_scope_organization_unit_id_fkey",
  );
  pgm.addConstraint(
    "user_role_assignments",
    "user_role_assignments_scope_organization_unit_id_fkey",
    {
      foreignKeys: {
        columns: "scope_organization_unit_id",
        references: "organization_units",
        onDelete: "CASCADE",
      },
    },
  );
};

exports.down = (pgm) => {
  pgm.dropConstraint(
    "user_role_assignments",
    "user_role_assignments_scope_organization_unit_id_fkey",
  );
  pgm.addConstraint(
    "user_role_assignments",
    "user_role_assignments_scope_organization_unit_id_fkey",
    {
      foreignKeys: {
        columns: "scope_organization_unit_id",
        references: "organization_units",
      },
    },
  );
};
