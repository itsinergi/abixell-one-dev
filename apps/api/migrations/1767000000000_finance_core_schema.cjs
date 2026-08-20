/**
 * Phase 6 — Finance Core schema (FIN-CORE-001…011).
 *
 * Core is OPERATIONAL CASH REALITY, not accounting. It answers: what money
 * came in or went out, how much, when, through which cash/bank account, for
 * what category, and what evidence supports it. Chart of accounts, journals,
 * general ledger, AP/AR, aging, budgeting, cost centres, reconciliation,
 * tax, depreciation, consolidation, and financial statements are Advanced
 * and deliberately absent.
 *
 * Deliberate design decisions:
 *
 * - **Money is numeric(18,2) and never touches JavaScript arithmetic.**
 *   node-postgres returns numeric as a STRING, and this module keeps it a
 *   string end to end. Every sum and every balance change is computed by
 *   PostgreSQL inside the mutating statement, so binary floating point can
 *   never corrupt a stored total.
 *
 * - **ONE authoritative money transaction.** There is no separate income
 *   table, expense table, or cash-movement table: direction is a column.
 *   Two aggregates for one fact would eventually disagree.
 *
 * - **The ledger is authoritative; the account balance is a derived cache.**
 *   A balance is never editable on its own. It changes only when a
 *   transaction is applied, in the same database transaction, under a row
 *   lock, and the guarded statement also refuses to take an account below
 *   zero.
 *
 * - **Approval belongs to the Workflow Engine** (FIN-CORE-006) through
 *   workflow_instance_id. There is no status column: pending / approved /
 *   rejected / cancelled is read from the Workflow instance, and "money has
 *   actually moved" is applied_at. No second lifecycle engine, and
 *   deliberately no state named "posted" — nothing is posted anywhere,
 *   because there is no ledger to post to.
 *
 * - **Corrections are compensating transactions, never edits**
 *   (FIN-CORE-008). An applied transaction is immutable; reversing it
 *   creates a NEW opposite-direction transaction, linked both ways, which
 *   goes through the same approval lifecycle.
 *
 * - **Revenue context is Core; purchase context is not.** The module PRD
 *   makes Customer & Commercial a Core dependency and marks Supply Chain
 *   purchase context Advanced, so a transaction may reference a Customer
 *   but there is no supplier, purchase order, or invoice link here.
 *
 * - **No opening-balance field.** The PRD does not ask for one, and a
 *   directly writable starting balance would be exactly the editable
 *   balance this design forbids. An opening position is recorded as an
 *   ordinary approved income transaction under a tenant-configured
 *   category.
 *
 * - **Categories reuse Reference Data.** FIN-CORE-003 asks for a
 *   configurable per-tenant catalog, which the Configuration Engine already
 *   provides with a full CRUD surface. A finance_categories table would
 *   duplicate a platform capability.
 *
 * gen_random_uuid() comes from pgcrypto (migration 0001).
 */
exports.up = (pgm) => {
  pgm.sql(`
    -- Operational money containers. These are NOT chart-of-accounts / GL
    -- accounts: no GL mapping, statement import, reconciliation settings,
    -- interest, or credit limit exists or is intended.
    CREATE TABLE finance_accounts (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      code                  text NOT NULL,
      name                  text NOT NULL,
      account_type          text NOT NULL,
      -- Explicit per account. No FX conversion, rate table, or revaluation.
      currency              text NOT NULL,
      description           text,
      legal_entity_id       uuid REFERENCES legal_entities(id) ON DELETE SET NULL,
      -- Data Scope anchor for the account and everything booked against it.
      organization_unit_id  uuid REFERENCES organization_units(id) ON DELETE SET NULL,
      -- Derived cache of the applied ledger, never directly editable.
      balance               numeric(18,2) NOT NULL DEFAULT 0,
      is_active             boolean NOT NULL DEFAULT true,
      created_at            timestamptz NOT NULL DEFAULT now(),
      created_by            uuid,
      updated_at            timestamptz NOT NULL DEFAULT now(),
      updated_by            uuid,
      CONSTRAINT finance_accounts_type_check
        CHECK (account_type IN ('cash', 'bank', 'petty_cash')),
      CONSTRAINT finance_accounts_balance_check CHECK (balance >= 0),
      UNIQUE (tenant_id, code)
    );

    CREATE TABLE finance_transactions (
      id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      transaction_number       text NOT NULL,
      direction                text NOT NULL,
      -- Two decimal places, always positive; direction carries the sign.
      amount                   numeric(18,2) NOT NULL,
      currency                 text NOT NULL,
      -- A calendar date, not a timestamp: read and written as YYYY-MM-DD so
      -- no timezone conversion can shift it a day (the Phase 3 lesson).
      transaction_date         date NOT NULL,
      account_id               uuid NOT NULL REFERENCES finance_accounts(id) ON DELETE RESTRICT,
      -- Validated against the tenant Reference Data catalog, stored as code.
      category_code            text NOT NULL,
      description              text,
      -- Free-text external reference (receipt no, transfer ref). NOT a link
      -- to an invoice, purchase order, or any AP/AR document.
      reference                text,
      legal_entity_id          uuid REFERENCES legal_entities(id) ON DELETE SET NULL,
      organization_unit_id     uuid REFERENCES organization_units(id) ON DELETE SET NULL,
      project_id               uuid REFERENCES projects(id) ON DELETE SET NULL,
      site_id                  uuid REFERENCES sites(id) ON DELETE SET NULL,
      -- Optional revenue context only. No receivable, no aging, no dunning.
      customer_id              uuid REFERENCES customers(id) ON DELETE SET NULL,
      -- The ONE link to the generic Workflow Engine (FIN-CORE-006).
      workflow_instance_id     uuid REFERENCES workflow_instances(id) ON DELETE SET NULL,
      recorded_by_user_id      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      -- Set exactly once, when the money actually moves.
      applied_at               timestamptz,
      applied_by_user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
      -- Compensating-entry links (FIN-CORE-008). Both sides recorded so a
      -- correction is traceable in either direction.
      reverses_transaction_id  uuid,
      reversed_by_transaction_id uuid,
      created_at               timestamptz NOT NULL DEFAULT now(),
      created_by               uuid,
      updated_at               timestamptz NOT NULL DEFAULT now(),
      updated_by               uuid,
      CONSTRAINT finance_transactions_direction_check
        CHECK (direction IN ('income', 'expense')),
      CONSTRAINT finance_transactions_amount_check CHECK (amount > 0),
      UNIQUE (tenant_id, transaction_number)
    );

    ALTER TABLE finance_transactions
      ADD CONSTRAINT finance_transactions_reverses_fk
      FOREIGN KEY (reverses_transaction_id) REFERENCES finance_transactions(id) ON DELETE SET NULL;
    ALTER TABLE finance_transactions
      ADD CONSTRAINT finance_transactions_reversed_by_fk
      FOREIGN KEY (reversed_by_transaction_id) REFERENCES finance_transactions(id) ON DELETE SET NULL;

    -- A transaction can be reversed at most once. Enforced by the database
    -- rather than by convention, so two concurrent corrections cannot both
    -- succeed and double-count the compensation.
    CREATE UNIQUE INDEX uq_finance_transactions_reverses
      ON finance_transactions(reverses_transaction_id)
      WHERE reverses_transaction_id IS NOT NULL;

    CREATE INDEX idx_finance_accounts_tenant_active ON finance_accounts(tenant_id, is_active);
    CREATE INDEX idx_finance_accounts_tenant_unit ON finance_accounts(tenant_id, organization_unit_id);
    CREATE INDEX idx_finance_transactions_tenant_date
      ON finance_transactions(tenant_id, transaction_date DESC);
    CREATE INDEX idx_finance_transactions_account
      ON finance_transactions(account_id, transaction_date);
    CREATE INDEX idx_finance_transactions_applied
      ON finance_transactions(tenant_id, applied_at) WHERE applied_at IS NOT NULL;
    CREATE INDEX idx_finance_transactions_workflow ON finance_transactions(workflow_instance_id);
    CREATE INDEX idx_finance_transactions_category ON finance_transactions(tenant_id, category_code);
  `);

  // --- Permissions (Product Core catalog, capability-based) -------------
  pgm.sql(`
    INSERT INTO permissions (code, description)
    SELECT v.code, v.description
      FROM (VALUES
        ('finance.read', 'View cash/bank accounts, transactions, and the cashflow view (subject to Data Scope)'),
        ('finance.manage', 'Record income and expense transactions and request corrections'),
        ('finance.approve', 'Decide on transactions in the configured approval lifecycle'),
        ('finance.configure', 'Maintain cash/bank accounts and the transaction category catalog'),
        ('finance.documents.read', 'Access evidence attached to a finance transaction')
      ) AS v(code, description)
     WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = v.code)
  `);

  // --- Reference Data type (Product Core registers the TYPE only) -------
  pgm.sql(`
    INSERT INTO reference_data_types (code, name, description)
    SELECT v.code, v.name, v.description
      FROM (VALUES
        ('finance_transaction_category', 'Finance Transaction Category', 'Tenant-configurable income/expense category catalog. NOT a chart of accounts.')
      ) AS v(code, name, description)
     WHERE NOT EXISTS (SELECT 1 FROM reference_data_types t WHERE t.code = v.code)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM reference_data_types WHERE code = 'finance_transaction_category';
    DELETE FROM permissions WHERE code IN (
      'finance.read', 'finance.manage', 'finance.approve', 'finance.configure', 'finance.documents.read'
    );
    ALTER TABLE finance_transactions DROP CONSTRAINT IF EXISTS finance_transactions_reverses_fk;
    ALTER TABLE finance_transactions DROP CONSTRAINT IF EXISTS finance_transactions_reversed_by_fk;
    DROP TABLE IF EXISTS finance_transactions;
    DROP TABLE IF EXISTS finance_accounts;
  `);
};
