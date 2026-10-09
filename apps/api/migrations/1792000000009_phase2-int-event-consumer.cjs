/**
 * Phase 2 — Event Consumer + Idempotency + Retry (WP-INT-01..03)
 *
 * Adds the scheduler job registration for "accounting-event-poster" (the
 * consumer loop that claims pending SCM accounting-ready events, generates
 * journals via posting rules, and posts them with idempotency dedup).
 * Also registers the manual requeue HTTP endpoint via app_api_resources.
 *
 * Follows the rename-chain pattern (1792000000008): the prior canonical
 * `config_dictionary_api_resource_seed` is preserved as `_phase1g`, and the
 * new canonical is a UNION over it plus the new requeue endpoint.
 *
 * Epic 14 §4.14 keputusan #1–22 ACTIVE; DEC-009/011/013 (Event Delivery,
 * Idempotency, Retry Logic) locked; Phase 2 Event Consumer contract signed.
 */

exports.shorthands = undefined;

const NEW_API_RESOURCES = `
        ('api:POST /accounting/events/:id/requeue', 'finance', 'POST', '/accounting/events/:id/requeue')
`;

exports.up = (pgm) => {
  // Register scheduler job for "accounting-event-poster" (Phase 2 WP-INT-01..03).
  // Consumes scm_accounting_ready_events outbox, generates journals via posting
  // rules, posts atomically, and records idempotency metadata for retry safety.
  // Multi-replica safety is inherited from Scheduler's persisted execution lease.
  pgm.sql(`
    INSERT INTO scheduled_jobs
      (job_code, name, description, interval_seconds, handler_key, is_enabled)
    VALUES (
      'accounting-event-poster',
      'Accounting Event Poster',
      'Consumes SCM accounting-ready events from the outbox, generates journals via posting rules, posts them atomically, and records idempotency metadata for retry safety.',
      60,
      'accounting-event-poster',
      true
    )
    ON CONFLICT (job_code) DO NOTHING
  `);

  // Register the manual requeue HTTP endpoint via the rename-chain pattern.
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_dictionary_api_resource_seed'
           AND n.nspname = current_schema()
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_dictionary_api_resource_seed_phase1g'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed()
          RENAME TO config_dictionary_api_resource_seed_phase1g;
      END IF;
    END
    $$;

    CREATE OR REPLACE FUNCTION config_dictionary_api_resource_seed()
    RETURNS TABLE (code TEXT, name TEXT, module_code TEXT, http_method TEXT, path_pattern TEXT) AS $seed$
      SELECT s.code, s.name, s.module_code, s.http_method, s.path_pattern
        FROM config_dictionary_api_resource_seed_phase1g() s
      UNION
      SELECT a.code, a.http_method || ' ' || a.path_pattern, a.module_code, a.http_method, a.path_pattern
        FROM (VALUES
          ${NEW_API_RESOURCES}
        ) AS a(code, module_code, http_method, path_pattern);
    $seed$ LANGUAGE sql IMMUTABLE;

    INSERT INTO app_api_resources (tenant_id, code, name, module_code, http_method, path_pattern)
    SELECT t.id, a.code, a.http_method || ' ' || a.path_pattern, a.module_code, a.http_method, a.path_pattern
      FROM tenants t
      CROSS JOIN (VALUES
        ${NEW_API_RESOURCES}
      ) AS a(code, module_code, http_method, path_pattern)
    ON CONFLICT (tenant_id, code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  // Remove the scheduled job registration.
  pgm.sql(`DELETE FROM scheduled_jobs WHERE job_code = 'accounting-event-poster'`);

  // Remove the API resource for the requeue endpoint and revert the rename-chain.
  pgm.sql(`
    DELETE FROM app_api_resources
     WHERE code IN (
       SELECT a.code FROM (VALUES
         ${NEW_API_RESOURCES}
       ) AS a(code, module_code, http_method, path_pattern)
     );

    DROP FUNCTION IF EXISTS config_dictionary_api_resource_seed();

    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname = 'config_dictionary_api_resource_seed_phase1g'
           AND n.nspname = current_schema()
      ) THEN
        ALTER FUNCTION config_dictionary_api_resource_seed_phase1g()
          RENAME TO config_dictionary_api_resource_seed;
      END IF;
    END
    $$;
  `);
};
