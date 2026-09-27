/**
 * Epic 3 Wave 3 step 11 — tenant label override for menus
 * (CORE-ROADMAP.md §4.3 step 11, §4.2 "Label" and "Cakupan tenant").
 *
 * "11. Penimpa label tenant dari daftar istilah yang diizinkan."
 *
 * §4.2 fixes the shape of what may be overridden and by whom:
 *   - "Label: **Label dan deskripsi boleh ditimpa tenant**, dibatasi daftar
 *     istilah yang diizinkan". Identity (`app_menus.code`) is locked; a label
 *     is free to change. Overriding a label never moves a menu, and never
 *     changes what it may reach.
 *   - "Tenant hanya menimpa yang aman: label, terminologi, urutan field,
 *     field disembunyikan." The access-definition columns on `app_menus`
 *     (window_id, module_id, required_permissions, is_external_allowed) are
 *     NOT reachable through this path — the query below only ever reads the
 *     tenant override for a menu's name and description.
 *
 * THE ALLOWLIST IS CODE-OWNED, NOT "WHATEVER MENUS THE TENANT HAS".
 * `menu_terminology_allowlist` is a Product Core table seeded by this
 * migration from `config_menu_seed()` — the same single source of truth the
 * Wave 1 menu catalogue uses. `menu_code` is deliberately NOT a foreign key
 * to `app_menus`: those rows are per-tenant and are re-seeded/backfilled per
 * tenant, while the allowlist states, once, WHICH (menu, field) pairs may
 * ever be overridden. A menu code the allowlist does not name has no
 * terminology key pointed at it, so the repository join finds nothing and no
 * override — however it arrived in `tenant_terminology_overrides` — can ever
 * reach the served tree. That is the "dibatasi daftar istilah yang
 * diizinkan" gate, enforced by the shape of the data rather than by a check
 * somebody has to remember to write.
 *
 * TWO BOUNDED SCHEMAS, because a label and a description are not the same
 * kind of string. `terminology.value` is capped at 60 characters — the right
 * bound for a term like "Site", the wrong bound for a sentence such as
 * "Govern statutory policy, salary profiles, payroll runs, and payslips."
 * So this migration adds `terminology.description_value` (240) alongside it;
 * `ConfigurationService.setTerminologyOverride` picks whichever the key
 * names. §4.2's "Schema Registry" is what makes the bound real, so the bound
 * belongs there, not in an ad-hoc `if` in the route.
 *
 * No permission is introduced here and no `role_permissions` row is written:
 * overriding a label is a configuration write, so it is the existing
 * `config.manage` — never a new grant.
 */

exports.up = async (pgm) => {
  // ==========================================================================
  // 1. Schema Registry — a bounded shape for a description override
  // ==========================================================================
  pgm.sql(`
    INSERT INTO metadata_registry (area, key, json_schema, description) VALUES
      ('terminology', 'description_value', '${JSON.stringify({
        type: "string",
        minLength: 1,
        maxLength: 240,
      })}', 'A Terminology override value for a longer text field (e.g. a menu description): bounded at 240 characters.')
  `);

  // ==========================================================================
  // 2. The allowlist — which (menu, field) pairs may ever be overridden
  // ==========================================================================
  pgm.createTable("menu_terminology_allowlist", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    /** Stable menu code (§4.3: code is locked, label is not). Not an FK —
     * the allowlist is core, `app_menus` is per-tenant. */
    menu_code: { type: "text", notNull: true },
    /** Which overridable field of the menu this key feeds. */
    field: { type: "text", notNull: true },
    terminology_key_id: {
      type: "uuid",
      notNull: true,
      references: "terminology_keys",
      onDelete: "CASCADE",
    },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("menu_terminology_allowlist", "menu_terminology_allowlist_code_field_unique", {
    unique: ["menu_code", "field"],
  });
  pgm.addConstraint("menu_terminology_allowlist", "menu_terminology_allowlist_field_check", {
    check: "field IN ('name', 'description')",
  });

  // ==========================================================================
  // 3. Seed — one terminology key per allowed (menu, field), read from the
  //    Wave 1 catalogue function so the two can never drift apart
  // ==========================================================================
  // `menu.<menu code>.name` / `menu.<menu code>.description`, following the
  // existing dotted namespace (`organization_unit.label`). The `default_label`
  // is the core value the catalogue states; the served tree falls back to
  // `app_menus` itself, so this copy is for the terminology catalog only.
  pgm.sql(`
    INSERT INTO terminology_keys (code, default_label, description)
    SELECT 'menu.' || s.code || '.name',
           s.name,
           'Tenant label override for the menu ' || s.code || ' (Epic 3 Wave 3, §4.3 step 11).'
      FROM config_menu_seed() s
    ON CONFLICT (code) DO NOTHING;

    -- Only menus that HAVE a description get an overridable one; seeding a
    -- key for a NULL default would put an empty term in the catalog.
    INSERT INTO terminology_keys (code, default_label, description)
    SELECT 'menu.' || s.code || '.description',
           s.description,
           'Tenant description override for the menu ' || s.code || ' (Epic 3 Wave 3, §4.3 step 11).'
      FROM config_menu_seed() s
     WHERE s.description IS NOT NULL
    ON CONFLICT (code) DO NOTHING;
  `);

  pgm.sql(`
    INSERT INTO menu_terminology_allowlist (menu_code, field, terminology_key_id)
    SELECT s.code, 'name', tk.id
      FROM config_menu_seed() s
      JOIN terminology_keys tk ON tk.code = 'menu.' || s.code || '.name';

    INSERT INTO menu_terminology_allowlist (menu_code, field, terminology_key_id)
    SELECT s.code, 'description', tk.id
      FROM config_menu_seed() s
      JOIN terminology_keys tk ON tk.code = 'menu.' || s.code || '.description'
     WHERE s.description IS NOT NULL;
  `);
};

exports.down = async (pgm) => {
  // Drop the allowlist first: it references the terminology keys this
  // migration added, and Postgres refuses to delete a referenced row while
  // the reference is still in place.
  pgm.dropTable("menu_terminology_allowlist");
  // Deleting the keys cascades to any tenant override that was set against
  // one, so rolling back the feature cannot leave an orphan override behind
  // for a later re-apply to pick back up.
  pgm.sql(`DELETE FROM terminology_keys WHERE code LIKE 'menu.%'`);
  pgm.sql(`
    DELETE FROM metadata_registry
     WHERE area = 'terminology' AND key = 'description_value'
  `);
};
