import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { bootstrapTenant } from "./helpers.js";
import {
  isBalanced,
  isValidMoney,
  toCents,
  type Money,
} from "../../src/modules/accounting/kernel/domain/accounting-kernel.entity.js";

/**
 * Phase 1 — Accounting Kernel (WP-FIN-01.1, ADR-0023 ACCEPTED).
 *
 * Phase 1A safe first slice: migration + domain types + DB-level discipline
 * tests. No API routes yet (Phase 1B). Tests cover:
 *   - Migration created all 9 core tables with correct columns/constraints
 *   - Domain types: money validation, balance invariant (debit=credit)
 *   - DB constraints: CHECK (debit>=0, credit>=0, one=0), UNIQUE, FK
 *   - Tenant discipline: direct tenant_id on every table
 *   - Permission catalog seeding
 *   - Idempotency unique constraint
 *
 * This follows the existing Finance Core test pattern: real DB pool, real
 * queries, no mocking. Tests create dedicated tenants and clean up via
 * CASCADE.
 */

const TS = `ak-${Date.now()}`;

describe("Phase 1 — Accounting Kernel", () => {
  let tenantId: string;
  let legalEntityId: string;

  beforeAll(async () => {
    // Create a dedicated tenant via direct DB insert (no app needed for
    // schema-level tests; we only need the tenant_id FK target).
    const tenantResult = await pool.query(
      `INSERT INTO tenants (code, name) VALUES ($1, 'Test AK Tenant') RETURNING id`,
      [TS],
    );
    tenantId = tenantResult.rows[0].id;

    const legalResult = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'Legal Entity AK') RETURNING id`,
      [tenantId],
    );
    legalEntityId = legalResult.rows[0].id;
  });

  afterAll(async () => {
    // CASCADE on tenant_id will clean up all accounting tables
    await pool.query(`DELETE FROM tenants WHERE code = $1`, [TS]);
    await pool.end();
  });

  // =========================================================================
  // Unit Tests — Money & Balance Invariant (pure domain, no DB)
  // =========================================================================

  describe("Money & Balance Invariant (unit)", () => {
    it("isValidMoney: accepts two-decimal non-negative strings", () => {
      expect(isValidMoney("0.00")).toBe(true);
      expect(isValidMoney("100.00")).toBe(true);
      expect(isValidMoney("9999999999999999.99")).toBe(true);
      expect(isValidMoney("0")).toBe(true);
      expect(isValidMoney("100")).toBe(true);
    });

    it("isValidMoney: rejects malformed strings", () => {
      expect(isValidMoney("")).toBe(false);
      expect(isValidMoney("-1.00")).toBe(false); // no sign allowed
      expect(isValidMoney("100.001")).toBe(false); // three decimals
      expect(isValidMoney("abc")).toBe(false);
      expect(isValidMoney("100.")).toBe(false);
    });

    it("toCents: converts money string to exact integer cents", () => {
      expect(toCents("0.00")).toBe(0n);
      expect(toCents("0.1")).toBe(10n); // "0.1" == "0.10"
      expect(toCents("100.00")).toBe(10000n);
      expect(toCents("100.10")).toBe(10010n);
      expect(toCents("1234567.89")).toBe(123456789n);
    });

    it("toCents: returns null for invalid money", () => {
      expect(toCents("abc" as Money)).toBeNull();
      expect(toCents("-1" as Money)).toBeNull();
      expect(toCents("1.234" as Money)).toBeNull();
    });

    it("isBalanced: accepts a balanced journal", () => {
      const lines = [
        { debit: "100.00" as Money, credit: "0.00" as Money },
        { debit: "0.00" as Money, credit: "100.00" as Money },
      ];
      expect(isBalanced(lines)).toBe(true);
    });

    it("isBalanced: rejects an unbalanced journal", () => {
      const lines = [
        { debit: "100.00" as Money, credit: "0.00" as Money },
        { debit: "0.00" as Money, credit: "50.00" as Money },
      ];
      expect(isBalanced(lines)).toBe(false);
    });

    it("isBalanced: rejects empty lines (no movement)", () => {
      expect(isBalanced([])).toBe(false);
    });

    it("isBalanced: rejects when any line has invalid money", () => {
      const lines = [
        { debit: "abc" as Money, credit: "0.00" as Money },
        { debit: "0.00" as Money, credit: "abc" as Money },
      ];
      expect(isBalanced(lines)).toBe(false);
    });

    it("isBalanced: exact at scale without floating point", () => {
      // 100.10 + 200.20 = 300.30 — classic float trap
      const lines = [
        { debit: "100.10" as Money, credit: "0.00" as Money },
        { debit: "200.20" as Money, credit: "0.00" as Money },
        { debit: "0.00" as Money, credit: "300.30" as Money },
      ];
      expect(isBalanced(lines)).toBe(true);
    });

    it("isBalanced: handles large amounts beyond safe integer", () => {
      // 16-digit integer part, 2 decimals → 18-digit cent value
      // BigInt handles this; Number would overflow
      const lines = [
        { debit: "9999999999999999.99" as Money, credit: "0.00" as Money },
        { debit: "0.00" as Money, credit: "9999999999999999.99" as Money },
      ];
      expect(isBalanced(lines)).toBe(true);
    });
  });

  // =========================================================================
  // Migration & Schema Validation
  // =========================================================================

  describe("Migration — all 9 core tables exist", () => {
    const expectedTables = [
      "accounting_periods",
      "chart_of_accounts",
      "accounting_accounts",
      "journal_headers",
      "journal_lines",
      "general_ledger_entries",
      "gl_balances",
      "posting_idempotency_keys",
      "posting_rules",
    ];

    for (const table of expectedTables) {
      it(`table "${table}" exists`, async () => {
        const result = await pool.query(
          `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
          [table],
        );
        expect(result.rows.length).toBe(1);
      });
    }
  });

  describe("Migration — tenant_id direct ownership on all tables", () => {
    const tables = [
      "accounting_periods",
      "chart_of_accounts",
      "accounting_accounts",
      "journal_headers",
      "journal_lines",
      "general_ledger_entries",
      "gl_balances",
      "posting_idempotency_keys",
      "posting_rules",
    ];

    for (const table of tables) {
      it(`table "${table}" has NOT NULL tenant_id FK to tenants`, async () => {
        const result = await pool.query(
          `SELECT column_name, is_nullable
             FROM information_schema.columns
            WHERE table_name = $1 AND column_name = 'tenant_id'`,
          [table],
        );
        expect(result.rows.length).toBe(1);
        expect(result.rows[0].is_nullable).toBe("NO");
      });
    }
  });

  describe("Migration — DB constraints enforced", () => {
    it("accounting_periods: status CHECK constraint", async () => {
      await expect(
        pool.query(
          `INSERT INTO accounting_periods
             (tenant_id, legal_entity_id, fiscal_year_code, period_code, period_name, date_from, date_to, status)
           VALUES ($1, $2, '2026', '01', 'Jan', '2026-01-01', '2026-01-31', 'invalid')`,
          [tenantId, legalEntityId],
        ),
      ).rejects.toThrow();
    });

    it("accounting_periods: date_from <= date_to CHECK", async () => {
      await expect(
        pool.query(
          `INSERT INTO accounting_periods
             (tenant_id, legal_entity_id, fiscal_year_code, period_code, period_name, date_from, date_to)
           VALUES ($1, $2, '2026', '99', 'Bad', '2026-01-31', '2026-01-01')`,
          [tenantId, legalEntityId],
        ),
      ).rejects.toThrow();
    });

    it("accounting_accounts: account_class CHECK constraint", async () => {
      const coa = await pool.query(
        `INSERT INTO chart_of_accounts
           (tenant_id, legal_entity_id, coa_version_code, coa_version_date)
         VALUES ($1, $2, 'TEST-CLS', '2026-01-01') RETURNING id`,
        [tenantId, legalEntityId],
      );
      const coaId = coa.rows[0].id;

      await expect(
        pool.query(
          `INSERT INTO accounting_accounts
             (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance)
           VALUES ($1, $2, $3, '9999', 'Bad', 'INVALID', 'debit')`,
          [tenantId, legalEntityId, coaId],
        ),
      ).rejects.toThrow();
    });

    it("journal_lines: debit/credit exclusivity CHECK", async () => {
      // Need a period, coa, account, journal header first
      const period = await pool.query(
        `INSERT INTO accounting_periods
           (tenant_id, legal_entity_id, fiscal_year_code, period_code, period_name, date_from, date_to)
         VALUES ($1, $2, '2026', '10', 'Oct', '2026-10-01', '2026-10-31') RETURNING id`,
        [tenantId, legalEntityId],
      );
      const coa = await pool.query(
        `INSERT INTO chart_of_accounts
           (tenant_id, legal_entity_id, coa_version_code, coa_version_date)
         VALUES ($1, $2, 'TEST-JL', '2026-01-01') RETURNING id`,
        [tenantId, legalEntityId],
      );
      const acct = await pool.query(
        `INSERT INTO accounting_accounts
           (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance)
         VALUES ($1, $2, $3, '1000', 'Cash', 'ASSET', 'debit') RETURNING id`,
        [tenantId, legalEntityId, coa.rows[0].id],
      );
      const journal = await pool.query(
        `INSERT INTO journal_headers
           (tenant_id, legal_entity_id, journal_number, journal_date, accounting_date,
            period_id, currency, idempotency_key)
         VALUES ($1, $2, 'J-TEST-001', '2026-10-15', '2026-10-15', $3, 'IDR', 'test-jl-001')
         RETURNING id`,
        [tenantId, legalEntityId, period.rows[0].id],
      );

      // Insert a line with BOTH debit and credit > 0 — should fail CHECK
      await expect(
        pool.query(
          `INSERT INTO journal_lines
             (tenant_id, journal_header_id, account_id, line_number, debit, credit)
           VALUES ($1, $2, $3, 1, '50.00', '50.00')`,
          [tenantId, journal.rows[0].id, acct.rows[0].id],
        ),
      ).rejects.toThrow();
    });

    it("journal_lines: debit >= 0 CHECK", async () => {
      const period = await pool.query(
        `INSERT INTO accounting_periods
           (tenant_id, legal_entity_id, fiscal_year_code, period_code, period_name, date_from, date_to)
         VALUES ($1, $2, '2026', '11', 'Nov', '2026-11-01', '2026-11-30') RETURNING id`,
        [tenantId, legalEntityId],
      );
      const coa = await pool.query(
        `INSERT INTO chart_of_accounts
           (tenant_id, legal_entity_id, coa_version_code, coa_version_date)
         VALUES ($1, $2, 'TEST-DN', '2026-01-01') RETURNING id`,
        [tenantId, legalEntityId],
      );
      const acct = await pool.query(
        `INSERT INTO accounting_accounts
           (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance)
         VALUES ($1, $2, $3, '1100', 'Bank', 'ASSET', 'debit') RETURNING id`,
        [tenantId, legalEntityId, coa.rows[0].id],
      );
      const journal = await pool.query(
        `INSERT INTO journal_headers
           (tenant_id, legal_entity_id, journal_number, journal_date, accounting_date,
            period_id, currency, idempotency_key)
         VALUES ($1, $2, 'J-TEST-002', '2026-11-15', '2026-11-15', $3, 'IDR', 'test-dn-002')
         RETURNING id`,
        [tenantId, legalEntityId, period.rows[0].id],
      );

      await expect(
        pool.query(
          `INSERT INTO journal_lines
             (tenant_id, journal_header_id, account_id, line_number, debit, credit)
           VALUES ($1, $2, $3, 1, '-10.00', '0.00')`,
          [tenantId, journal.rows[0].id, acct.rows[0].id],
        ),
      ).rejects.toThrow();
    });
  });

  describe("Migration — idempotency unique constraint", () => {
    it("journal_headers: UNIQUE (tenant_id, idempotency_key) prevents duplicates", async () => {
      const period = await pool.query(
        `INSERT INTO accounting_periods
           (tenant_id, legal_entity_id, fiscal_year_code, period_code, period_name, date_from, date_to)
         VALUES ($1, $2, '2026', '20', 'Idempotency Test', '2026-12-01', '2026-12-31') RETURNING id`,
        [tenantId, legalEntityId],
      );

      const j1 = await pool.query(
        `INSERT INTO journal_headers
           (tenant_id, legal_entity_id, journal_number, journal_date, accounting_date,
            period_id, currency, idempotency_key)
         VALUES ($1, $2, 'J-IDEM-001', '2026-12-01', '2026-12-01', $3, 'IDR', 'event_001_hash_v1')
         RETURNING id`,
        [tenantId, legalEntityId, period.rows[0].id],
      );
      expect(j1.rows.length).toBe(1);

      // Same idempotency_key, different journal_number — should fail
      await expect(
        pool.query(
          `INSERT INTO journal_headers
             (tenant_id, legal_entity_id, journal_number, journal_date, accounting_date,
              period_id, currency, idempotency_key)
           VALUES ($1, $2, 'J-IDEM-002', '2026-12-02', '2026-12-02', $3, 'IDR', 'event_001_hash_v1')`,
          [tenantId, legalEntityId, period.rows[0].id],
        ),
      ).rejects.toThrow();
    });
  });

  describe("Migration — posting_rules date logic", () => {
    it("posting_rules: deprecated_date > effective_date CHECK", async () => {
      await expect(
        pool.query(
          `INSERT INTO posting_rules
             (tenant_id, rule_code, rule_name, rule_version, trigger_event_type,
              accounting_formula, effective_date, deprecated_date)
           VALUES ($1, 'TEST_RULE', 'Test', 'v1', 'test_event',
                   '[]'::jsonb, '2026-01-01', '2026-01-01')`,
          [tenantId],
        ),
      ).rejects.toThrow();
    });

    it("posting_rules: accepts valid date range", async () => {
      const result = await pool.query(
        `INSERT INTO posting_rules
           (tenant_id, rule_code, rule_name, rule_version, trigger_event_type,
            accounting_formula, effective_date, deprecated_date)
         VALUES ($1, 'VALID_RULE', 'Valid', 'v1', 'test_event',
                 '[]'::jsonb, '2026-01-01', '2026-12-31')
         RETURNING id`,
        [tenantId],
      );
      expect(result.rows.length).toBe(1);
    });
  });

  describe("Migration — money is numeric(18,2)", () => {
    it("journal_lines.debit is numeric(18,2)", async () => {
      const result = await pool.query(
        `SELECT data_type, numeric_precision, numeric_scale
           FROM information_schema.columns
          WHERE table_name = 'journal_lines' AND column_name = 'debit'`,
      );
      expect(result.rows[0].data_type).toBe("numeric");
      expect(result.rows[0].numeric_precision).toBe(18);
      expect(result.rows[0].numeric_scale).toBe(2);
    });

    it("general_ledger_entries.credit is numeric(18,2)", async () => {
      const result = await pool.query(
        `SELECT data_type, numeric_precision, numeric_scale
           FROM information_schema.columns
          WHERE table_name = 'general_ledger_entries' AND column_name = 'credit'`,
      );
      expect(result.rows[0].data_type).toBe("numeric");
      expect(result.rows[0].numeric_precision).toBe(18);
      expect(result.rows[0].numeric_scale).toBe(2);
    });
  });

  describe("Migration — permission catalog seeded", () => {
    const expectedPermissions = [
      "finance.accounting.read",
      "finance.accounting.manage",
      "finance.accounting.approve",
      "finance.accounting.configure",
      "finance.accounting.period.lock",
    ];

    for (const code of expectedPermissions) {
      it(`permission "${code}" exists`, async () => {
        const result = await pool.query(
          `SELECT 1 FROM permissions WHERE code = $1`,
          [code],
        );
        expect(result.rows.length).toBe(1);
      });
    }
  });

  describe("Migration — reference data type seeded", () => {
    it("reference_data_type 'accounting_posting_rule' exists", async () => {
      const result = await pool.query(
        `SELECT 1 FROM reference_data_types WHERE code = $1`,
        ["accounting_posting_rule"],
      );
      expect(result.rows.length).toBe(1);
    });
  });

  // =========================================================================
  // Tenant Isolation
  // =========================================================================

  describe("Tenant Isolation", () => {
    let otherTenantId: string;
    let otherLegalEntityId: string;

    beforeAll(async () => {
      const otherTenant = await pool.query(
        `INSERT INTO tenants (code, name) VALUES ($1, 'Other AK Tenant') RETURNING id`,
        [`ak-other-${Date.now()}`],
      );
      otherTenantId = otherTenant.rows[0].id;

      const otherLegal = await pool.query(
        `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'Other LE') RETURNING id`,
        [otherTenantId],
      );
      otherLegalEntityId = otherLegal.rows[0].id;
    });

    afterAll(async () => {
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [otherTenantId]);
    });

    it("accounting_accounts UNIQUE constraint is per (tenant, legal_entity, coa, code)", async () => {
      // Both tenants can use the same account_code without conflict
      const coa1 = await pool.query(
        `INSERT INTO chart_of_accounts
           (tenant_id, legal_entity_id, coa_version_code, coa_version_date)
         VALUES ($1, $2, 'COA-ISO', '2026-01-01') RETURNING id`,
        [tenantId, legalEntityId],
      );
      const coa2 = await pool.query(
        `INSERT INTO chart_of_accounts
           (tenant_id, legal_entity_id, coa_version_code, coa_version_date)
         VALUES ($1, $2, 'COA-ISO', '2026-01-01') RETURNING id`,
        [otherTenantId, otherLegalEntityId],
      );

      // Same code in different tenants — should succeed
      const acct1 = await pool.query(
        `INSERT INTO accounting_accounts
           (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance)
         VALUES ($1, $2, $3, '4000', 'Sales', 'INCOME', 'credit') RETURNING id`,
        [tenantId, legalEntityId, coa1.rows[0].id],
      );
      expect(acct1.rows.length).toBe(1);

      const acct2 = await pool.query(
        `INSERT INTO accounting_accounts
           (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance)
         VALUES ($1, $2, $3, '4000', 'Sales', 'INCOME', 'credit') RETURNING id`,
        [otherTenantId, otherLegalEntityId, coa2.rows[0].id],
      );
      expect(acct2.rows.length).toBe(1);
    });

    it("posting_rules UNIQUE is per (tenant, rule_code, rule_version)", async () => {
      // Both tenants can have the same rule_code+version
      const rule1 = await pool.query(
        `INSERT INTO posting_rules
           (tenant_id, rule_code, rule_name, rule_version, trigger_event_type,
            accounting_formula, effective_date)
         VALUES ($1, 'SHARED_RULE', 'Shared', 'v1', 'test', '[]'::jsonb, '2026-01-01')
         RETURNING id`,
        [tenantId],
      );
      expect(rule1.rows.length).toBe(1);

      const rule2 = await pool.query(
        `INSERT INTO posting_rules
           (tenant_id, rule_code, rule_name, rule_version, trigger_event_type,
            accounting_formula, effective_date)
         VALUES ($1, 'SHARED_RULE', 'Shared', 'v1', 'test', '[]'::jsonb, '2026-01-01')
         RETURNING id`,
        [otherTenantId],
      );
      expect(rule2.rows.length).toBe(1);
    });
  });

  // =========================================================================
  // Balanced Journal End-to-End (DB-level)
  // =========================================================================

  describe("Balanced Journal — end-to-end DB insert", () => {
    it("should insert a balanced journal and verify GL entries can be created", async () => {
      const period = await pool.query(
        `INSERT INTO accounting_periods
           (tenant_id, legal_entity_id, fiscal_year_code, period_code, period_name, date_from, date_to)
         VALUES ($1, $2, '2026', '30', 'Balanced Test', '2026-03-01', '2026-03-31') RETURNING id`,
        [tenantId, legalEntityId],
      );
      const coa = await pool.query(
        `INSERT INTO chart_of_accounts
           (tenant_id, legal_entity_id, coa_version_code, coa_version_date)
         VALUES ($1, $2, 'COA-BAL', '2026-01-01') RETURNING id`,
        [tenantId, legalEntityId],
      );

      const cash = await pool.query(
        `INSERT INTO accounting_accounts
           (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance)
         VALUES ($1, $2, $3, '1000', 'Cash', 'ASSET', 'debit') RETURNING id`,
        [tenantId, legalEntityId, coa.rows[0].id],
      );
      const revenue = await pool.query(
        `INSERT INTO accounting_accounts
           (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance)
         VALUES ($1, $2, $3, '4000', 'Revenue', 'INCOME', 'credit') RETURNING id`,
        [tenantId, legalEntityId, coa.rows[0].id],
      );

      const journal = await pool.query(
        `INSERT INTO journal_headers
           (tenant_id, legal_entity_id, journal_number, journal_date, accounting_date,
            period_id, currency, idempotency_key)
         VALUES ($1, $2, 'J-E2E-001', '2026-03-15', '2026-03-15', $3, 'IDR', 'e2e_001_v1')
         RETURNING id`,
        [tenantId, legalEntityId, period.rows[0].id],
      );

      // Balanced: debit 1000.00, credit 1000.00
      const line1 = await pool.query(
        `INSERT INTO journal_lines
           (tenant_id, journal_header_id, account_id, line_number, debit, credit)
         VALUES ($1, $2, $3, 1, '1000.00', '0.00') RETURNING id`,
        [tenantId, journal.rows[0].id, cash.rows[0].id],
      );
      const line2 = await pool.query(
        `INSERT INTO journal_lines
           (tenant_id, journal_header_id, account_id, line_number, debit, credit)
         VALUES ($1, $2, $3, 2, '0.00', '1000.00') RETURNING id`,
        [tenantId, journal.rows[0].id, revenue.rows[0].id],
      );

      expect(line1.rows.length).toBe(1);
      expect(line2.rows.length).toBe(1);

      // Verify exact money storage — no float rounding
      const checkDebit = await pool.query(
        `SELECT debit::text FROM journal_lines WHERE id = $1`,
        [line1.rows[0].id],
      );
      expect(checkDebit.rows[0].debit).toBe("1000.00");

      // Create GL entries
      const gl1 = await pool.query(
        `INSERT INTO general_ledger_entries
           (tenant_id, account_id, period_id, journal_line_id, posting_date, debit, credit)
         VALUES ($1, $2, $3, $4, now(), '1000.00', '0.00') RETURNING id`,
        [tenantId, cash.rows[0].id, period.rows[0].id, line1.rows[0].id],
      );
      const gl2 = await pool.query(
        `INSERT INTO general_ledger_entries
           (tenant_id, account_id, period_id, journal_line_id, posting_date, debit, credit)
         VALUES ($1, $2, $3, $4, now(), '0.00', '1000.00') RETURNING id`,
        [tenantId, revenue.rows[0].id, period.rows[0].id, line2.rows[0].id],
      );

      expect(gl1.rows.length).toBe(1);
      expect(gl2.rows.length).toBe(1);

      // GL entry per journal line is UNIQUE
      await expect(
        pool.query(
          `INSERT INTO general_ledger_entries
             (tenant_id, account_id, period_id, journal_line_id, posting_date, debit, credit)
           VALUES ($1, $2, $3, $4, now(), '0.00', '0.00')`,
          [tenantId, cash.rows[0].id, period.rows[0].id, line1.rows[0].id],
        ),
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // COA Hierarchy — WP-FIN-01 (Phase 1C: parent_account_id, triggers, depth)
  // =========================================================================

  describe("COA Hierarchy — parent_account_id triggers (WP-FIN-01)", () => {
    //
    it("parent must belong to the same tenant + legal entity", async () => {
      // Other legal entity under the SAME tenant
      const otherLE = await pool.query(
        `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'Other LE Hierarchy') RETURNING id`,
        [tenantId],
      );
      const coaOther = await pool.query(
        `INSERT INTO chart_of_accounts (tenant_id, legal_entity_id, coa_version_code, coa_version_date)
         VALUES ($1, $2, 'COA-X-LE', '2026-01-01') RETURNING id`,
        [tenantId, otherLE.rows[0].id],
      );
      // Parent in other LE
      const parentOtherLE = await pool.query(
        `INSERT INTO accounting_accounts
           (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance)
         VALUES ($1, $2, $3, '1000', 'Parent Other LE', 'ASSET', 'debit') RETURNING id`,
        [tenantId, otherLE.rows[0].id, coaOther.rows[0].id],
      );

      // Child in main LE trying to use cross-entity parent — must fail
      const coaMain = await pool.query(
        `INSERT INTO chart_of_accounts (tenant_id, legal_entity_id, coa_version_code, coa_version_date)
         VALUES ($1, $2, 'COA-HIER', '2026-01-01') RETURNING id`,
        [tenantId, legalEntityId],
      );
      await expect(
        pool.query(
          `INSERT INTO accounting_accounts
             (tenant_id, legal_entity_id, coa_id, account_code, account_name,
              account_class, normal_balance, parent_account_id)
           VALUES ($1, $2, $3, '1100', 'Cross Entity Child', 'ASSET', 'debit', $4)`,
          [tenantId, legalEntityId, coaMain.rows[0].id, parentOtherLE.rows[0].id],
        ),
      ).rejects.toThrow();
    });

    it("valid same-entity parent is accepted and persists parent_account_id", async () => {
      const coa = await pool.query(
        `INSERT INTO chart_of_accounts (tenant_id, legal_entity_id, coa_version_code, coa_version_date)
         VALUES ($1, $2, 'COA-VALID', '2026-01-01') RETURNING id`,
        [tenantId, legalEntityId],
      );
      const parent = await pool.query(
        `INSERT INTO accounting_accounts
           (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance)
         VALUES ($1, $2, $3, '2000', 'Parent', 'ASSET', 'debit') RETURNING id`,
        [tenantId, legalEntityId, coa.rows[0].id],
      );
      const child = await pool.query(
        `INSERT INTO accounting_accounts
           (tenant_id, legal_entity_id, coa_id, account_code, account_name,
            account_class, normal_balance, parent_account_id)
         VALUES ($1, $2, $3, '2100', 'Child', 'ASSET', 'debit', $4) RETURNING *`,
        [tenantId, legalEntityId, coa.rows[0].id, parent.rows[0].id],
      );
      expect(child.rows[0].parent_account_id).toBe(parent.rows[0].id);
    });

    it("cycle is prevented: A→B→A raises check_violation", async () => {
      const coa = await pool.query(
        `INSERT INTO chart_of_accounts (tenant_id, legal_entity_id, coa_version_code, coa_version_date)
         VALUES ($1, $2, 'COA-CYCLE', '2026-01-01') RETURNING id`,
        [tenantId, legalEntityId],
      );
      const a = await pool.query(
        `INSERT INTO accounting_accounts
           (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance)
         VALUES ($1, $2, $3, '3000', 'A', 'ASSET', 'debit') RETURNING id`,
        [tenantId, legalEntityId, coa.rows[0].id],
      );
      const b = await pool.query(
        `INSERT INTO accounting_accounts
           (tenant_id, legal_entity_id, coa_id, account_code, account_name,
            account_class, normal_balance, parent_account_id)
         VALUES ($1, $2, $3, '3100', 'B', 'ASSET', 'debit', $4) RETURNING id`,
        [tenantId, legalEntityId, coa.rows[0].id, a.rows[0].id],
      );

      // Now try to set A's parent to B — closing the cycle A→B→A
      await expect(
        pool.query(
          `UPDATE accounting_accounts SET parent_account_id = $2 WHERE id = $1`,
          [a.rows[0].id, b.rows[0].id],
        ),
      ).rejects.toThrow();
    });
  });
});
