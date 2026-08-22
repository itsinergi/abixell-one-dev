/**
 * Phase H2 corrective hardening.
 *
 * Establishes an explicit reconciliation eligibility boundary for every
 * outbound Endpoint, fences each processing lease with a unique claim token,
 * adds a cross-replica Scheduler execution lease, and records the Tenant for
 * manual Scheduler runs. Existing endpoints retain PH-8's original start
 * boundary so interrupted pre-correction enqueue remains reconcilable.
 */

exports.up = (pgm) => {
  pgm.addColumns("integration_endpoints", {
    eligible_from: {
      type: "timestamptz",
      notNull: false,
    },
  });
  pgm.sql(`
    UPDATE integration_endpoints
       SET eligible_from = (
         SELECT run_on
           FROM pgmigrations
          WHERE name = '1771000000000_phase-h2-production-hardening'
       )
  `);
  pgm.alterColumn("integration_endpoints", "eligible_from", {
    notNull: true,
    default: pgm.func("now()"),
  });

  pgm.addColumns("scheduled_jobs", {
    locked_at: { type: "timestamptz", notNull: false },
    lock_token: { type: "uuid", notNull: false },
  });
  pgm.createIndex("scheduled_jobs", ["locked_at"], {
    name: "scheduled_jobs_execution_lease_idx",
  });

  pgm.addColumns("integration_endpoints", {
    deactivated_at: { type: "timestamptz", notNull: false },
  });
  pgm.createTable("integration_endpoint_inactive_windows", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    integration_endpoint_id: {
      type: "uuid",
      notNull: true,
      references: "integration_endpoints",
      onDelete: "CASCADE",
    },
    inactive_from: { type: "timestamptz", notNull: true },
    inactive_to: { type: "timestamptz", notNull: true },
  });
  pgm.createIndex(
    "integration_endpoint_inactive_windows",
    ["integration_endpoint_id", "inactive_from", "inactive_to"],
    { name: "integration_endpoint_inactive_windows_lookup_idx" },
  );

  pgm.addColumns("integration_outbox_deliveries", {
    claim_token: { type: "uuid", notNull: false },
  });

  pgm.addColumns("scheduled_job_runs", {
    tenant_id: {
      type: "uuid",
      notNull: false,
      references: "tenants",
      onDelete: "CASCADE",
    },
  });
  pgm.createIndex("scheduled_job_runs", ["scheduled_job_id", "tenant_id", "started_at"], {
    name: "scheduled_job_runs_tenant_history_idx",
  });

};

exports.down = (pgm) => {
  pgm.dropIndex("scheduled_job_runs", ["scheduled_job_id", "tenant_id", "started_at"], {
    name: "scheduled_job_runs_tenant_history_idx",
  });
  pgm.dropColumns("scheduled_job_runs", ["tenant_id"]);
  pgm.dropColumns("integration_outbox_deliveries", ["claim_token"]);
  pgm.dropTable("integration_endpoint_inactive_windows");
  pgm.dropColumns("integration_endpoints", ["deactivated_at", "eligible_from"]);
  pgm.dropIndex("scheduled_jobs", ["locked_at"], {
    name: "scheduled_jobs_execution_lease_idx",
  });
  pgm.dropColumns("scheduled_jobs", ["locked_at", "lock_token"]);
};
