/**
 * Wave A6 Finance Advanced — Chart of Accounts Builder (Phase 2).
 *
 * Adds COA template tracking (`templateType`, `coaStatus`) to `chart_of_accounts`.
 * Templates are SAK_UMUM (full Indonesian standards) or SAK_EMKM (simplified),
 * seeded by migration 1794600000010 as draft awaiting accountant review.
 *
 * New columns:
 * - `template_type`: 'SAK_UMUM' | 'SAK_EMKM' | NULL (custom)
 * - `coa_status`: 'draft' | 'approved' (default 'draft')
 */

exports.up = (pgm) => {
  pgm.addColumns("chart_of_accounts", {
    template_type: {
      type: "varchar(20)",
      default: null,
      check: `template_type IN ('SAK_UMUM', 'SAK_EMKM')`,
    },
    coa_status: {
      type: "varchar(20)",
      notNull: true,
      default: "draft",
      check: `coa_status IN ('draft', 'approved')`,
    },
  });

  pgm.createIndex("chart_of_accounts", ["tenant_id", "coa_status"]);
};

exports.down = (pgm) => {
  pgm.dropIndex("chart_of_accounts", ["tenant_id", "coa_status"]);
  pgm.dropColumns("chart_of_accounts", ["template_type", "coa_status"]);
};
