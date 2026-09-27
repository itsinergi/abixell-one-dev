/**
 * Epic 3 — Route note correction (follows Epic 4 Wave 1, which holds the
 * previous prefix). Repairs one piece of stale seeded text carried in
 * `app_windows.description` since 1787200000000.
 *
 * What happened. When the route auto-registration migration seeded the
 * catalogue, the row for `/finance/transactions/:transactionId` described
 * itself as a "Read-only exception (§4.3)". That framing was an inference of
 * the audit at the time, and it turned out to be wrong twice over:
 *
 *   1. The page is not read-only. It writes through `finance.manage` and
 *      `finance.approve`; §4.3's final correction (route-registry.ts header,
 *      2026-09-27) records **zero** detail pages that perform no writes.
 *   2. Read-only mode is lapis 3 (`role_window_access`), which lives per
 *      role and per Window — it is never carried by the route itself.
 *
 * Why a migration and not an edit. 1787200000000 is historical; project
 * policy freezes migrations 1755500000000 through 1787600000000, so the wrong
 * text is repaired forward here, in two places:
 *
 *   - Existing tenants: an UPDATE scoped to the exact stale string, so only
 *     rows that actually carry the wrong wording change (a tenant could in
 *     principle have edited the description since seeding — that edit stands).
 *   - Future tenants: 1787200000000 defines the tenant trigger through
 *     `config_seed_app_windows_for_tenant()`, which copies `s.note` straight
 *     into `description`. That function is redefined here to map the one
 *     corrected note; every other note passes through untouched. The 70-row
 *     VALUES list in `config_route_window_seed()` is NOT restated — the
 *     trigger still reads the historical catalogue function verbatim.
 *
 * Down restores both halves: the description UPDATE is reversed under the
 * same exact-string scope, and the trigger function drops the CASE back to
 * the direct `s.note` copy.
 */
exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Existing tenants: repair only rows that still carry the stale text --
    UPDATE app_windows
       SET description =
         'Detail with its own window identity (§4.3); role read-only mode is lapis 3, not carried here.',
           updated_at = now()
     WHERE code = 'route:/finance/transactions/:transactionId'
       AND description =
         'Read-only exception (§4.3): own window identity so it can be locked apart from the list.';

    -- 2. Future tenants: keep the trigger, correct the one note it copies ----
    CREATE OR REPLACE FUNCTION config_seed_app_windows_for_tenant()
    RETURNS trigger AS $trg$
    BEGIN
      INSERT INTO app_windows (
        tenant_id, code, name, module_code,
        registration_status, required_permissions, parent_path, description
      )
      SELECT NEW.id, s.code, s.name, s.module_code,
             s.registration_status, s.required_permissions, s.parent_path,
             CASE
               WHEN s.code = 'route:/finance/transactions/:transactionId'
                    AND s.note =
                      'Read-only exception (§4.3): own window identity so it can be locked apart from the list.'
                 THEN 'Detail with its own window identity (§4.3); role read-only mode is lapis 3, not carried here.'
               ELSE s.note
             END
        FROM config_route_window_seed() s
      ON CONFLICT (tenant_id, code) DO NOTHING;
      RETURN NEW;
    END;
    $trg$ LANGUAGE plpgsql;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Reverse the trigger first (opposite order to up), then the data.
    CREATE OR REPLACE FUNCTION config_seed_app_windows_for_tenant()
    RETURNS trigger AS $trg$
    BEGIN
      INSERT INTO app_windows (
        tenant_id, code, name, module_code,
        registration_status, required_permissions, parent_path, description
      )
      SELECT NEW.id, s.code, s.name, s.module_code,
             s.registration_status, s.required_permissions, s.parent_path, s.note
        FROM config_route_window_seed() s
      ON CONFLICT (tenant_id, code) DO NOTHING;
      RETURN NEW;
    END;
    $trg$ LANGUAGE plpgsql;

    UPDATE app_windows
       SET description =
         'Read-only exception (§4.3): own window identity so it can be locked apart from the list.',
           updated_at = now()
     WHERE code = 'route:/finance/transactions/:transactionId'
       AND description =
         'Detail with its own window identity (§4.3); role read-only mode is lapis 3, not carried here.';
  `);
};
