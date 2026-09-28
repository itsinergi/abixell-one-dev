/**
 * Epic 1 Wave 1 (CORE-ROADMAP.md §4.1 D) — the tenant conversion rate table
 * `MWFActivity.getApprovalUser` (`:771-779`) needs before it may compare a
 * document amount against a Role limit expressed in another currency.
 *
 * Tenant-owned, like `MConversionRate` under AD_Client_ID: two tenants must be
 * free to hold different rates for the same pair.
 *
 * No seed rows. A rate is a fact about the world, so the product must not
 * invent one; a missing rate fails cleanly (`MissingConversionRateError`) and
 * the caller surfaces it. Falling back to 1:1 would approve amounts the
 * configured limit never authorised.
 *
 * No automatic inverse: `MConversionRate.convert` also does not flip a rate
 * unless the reverse pair is configured. Writing both directions is the
 * tenant's decision, not a convention the code assumes.
 *
 * `rate` is `numeric(18,6)`, matching the precision iDempiere's GetMultiplyRate
 * accepts, and stays a string in TypeScript — the comparison math runs on
 * scaled BigInt, never a binary float.
 *
 * `currency_code` is `varchar(3)` in both column names for the same reason the
 * Role limit uses it: ISO-4217 alpha-3 is the only currency identifier this
 * product has until a currency dictionary exists (Epic 14).
 *
 * `valid_to` NULL means "still current". Overlapping validity for the same
 * pair is rejected by the unique index only when `valid_from` matches, so a
 * tenant that supersedes a rate must close the old row — matching the
 * effective-dating convention used by `price_book_entries`.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("currency_conversion_rates", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    tenant_id: {
      type: "uuid",
      notNull: true,
      references: "tenants",
      onDelete: "CASCADE",
    },
    from_currency_code: { type: "varchar(3)", notNull: true },
    to_currency_code: { type: "varchar(3)", notNull: true },
    rate: { type: "numeric(18,6)", notNull: true },
    valid_from: { type: "date", notNull: true },
    valid_to: { type: "date" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.addConstraint("currency_conversion_rates", "currency_conversion_rates_rate_check", {
    check: "rate > 0",
  });
  pgm.addConstraint("currency_conversion_rates", "currency_conversion_rates_pair_check", {
    check: "from_currency_code <> to_currency_code",
  });
  pgm.addConstraint("currency_conversion_rates", "currency_conversion_rates_window_check", {
    check: "valid_to IS NULL OR valid_to >= valid_from",
  });
  pgm.createIndex(
    "currency_conversion_rates",
    ["tenant_id", "from_currency_code", "to_currency_code", "valid_from"],
    { unique: true },
  );
};

exports.down = (pgm) => {
  pgm.dropTable("currency_conversion_rates");
};
