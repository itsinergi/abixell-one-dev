/**
 * Phase 8 — Survey dueAt Scheduler (WP-SAT-01)
 *
 * Closes E2EGAP-015: assignments with a passed due_at are never automatically
 * flipped to 'expired' until this scheduler job runs. The scheduler loop calls
 * SurveyService.expireDueAssignmentsForTenant(tenantId) per tenant, which uses
 * FOR UPDATE SKIP LOCKED to safely process in multi-replica deployments.
 *
 * Registers the "survey-due-at-expiry-sweep" scheduler job (60-second interval)
 * and creates a partial index for fast candidate-row lookup.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Register scheduler job for survey assignment dueAt expiry (Phase 8 WP-SAT-01).
  // Sweeps each tenant's pending/in_progress assignments and flips those with
  // due_at <= now() to 'expired'. Multi-replica safety via FOR UPDATE SKIP LOCKED.
  pgm.sql(`
    INSERT INTO scheduled_jobs
      (job_code, name, description, interval_seconds, handler_key, is_enabled)
    VALUES (
      'survey-due-at-expiry-sweep',
      'Survey Due-At Expiry Sweep',
      'Expires survey assignments whose due_at has passed. Emits audit and domain events for each expired assignment. Multi-replica-safe via FOR UPDATE SKIP LOCKED.',
      60,
      'survey-due-at-expiry-sweep',
      true
    )
    ON CONFLICT (job_code) DO NOTHING
  `);

  // Partial index for fast candidate-row lookup in expireDueAssignments CTE.
  // Covers only rows that can be expired (pending/in_progress with a non-null
  // due_at). Raw SQL for parity with the codebase's existing partial indexes.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS survey_assignments_due_at_expiry_idx
      ON survey_assignments (tenant_id, due_at)
     WHERE status IN ('pending', 'in_progress') AND due_at IS NOT NULL
  `);
};

exports.down = (pgm) => {
  // Remove the scheduled job registration.
  pgm.sql(`DELETE FROM scheduled_jobs WHERE job_code = 'survey-due-at-expiry-sweep'`);

  // Remove the partial index.
  pgm.sql(`DROP INDEX IF EXISTS survey_assignments_due_at_expiry_idx`);
};
