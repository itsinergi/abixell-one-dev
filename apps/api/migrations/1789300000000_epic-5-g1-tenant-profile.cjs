/**
 * Epic 5 Gelombang 1 (§4.5 step 5) — Tenant profile metadata.
 *
 * G0 contract `docs/plans/epic-5-g0-contract.md` migration M1.
 *
 * §4.5 Putaran 6 locks the minimum Tenant profile: "name, code, status,
 * default timezone, default locale, default currency, owner/contact
 * administrator". `name`, `code`, and `status` already exist (1755600000000);
 * this migration adds the remaining five, all nullable so every existing row
 * stays valid without a backfill and no historical value is invented.
 *
 * Tenant is a workspace/data boundary, never the company profile — the
 * official legal identity lives on the Legal Entity (§4.5 principle 1). The
 * columns added here are the *defaults* a Legal Entity or Organization Unit
 * inherits when it does not override them (§4.5 Putaran 3: "Tenant mempunyai
 * default timezone. Legal Entity dan Organization Unit dapat override bila
 * perlu").
 *
 * The currency check is a format check, not a catalogue: Abixell One does not
 * own an ISO 4217 catalogue in Gelombang 1, and Finance owns conversion
 * (§4.5 base currency row). Three uppercase letters keeps the column usable
 * as a currency code without pretending the platform validates the code list.
 *
 * Additive only: no column dropped, no row rewritten, no default applied to
 * existing rows.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("tenants", {
    default_timezone: { type: "text" },
    default_locale: { type: "text" },
    default_currency: { type: "text" },
    contact_admin_name: { type: "text" },
    contact_admin_email: { type: "text" },
    contact_admin_phone: { type: "text" },
  });

  pgm.addConstraint("tenants", "tenants_default_currency_format_check", {
    check: "default_currency IS NULL OR default_currency ~ '^[A-Z]{3}$'",
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint("tenants", "tenants_default_currency_format_check");
  pgm.dropColumns("tenants", [
    "default_timezone",
    "default_locale",
    "default_currency",
    "contact_admin_name",
    "contact_admin_email",
    "contact_admin_phone",
  ]);
};
