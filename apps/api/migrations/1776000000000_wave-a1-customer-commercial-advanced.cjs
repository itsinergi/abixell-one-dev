exports.up = (pgm) => {
  pgm.sql(`

    -- -----------------------------------------------------------------------
    -- Wave A1 — CUS-ADV-001 Customer & Commercial Advanced.
    -- Sales pipeline (opportunity), quotation, and configurable pricing on
    -- top of the existing Customer Foundation. Deliberately does NOT restate
    -- Customer/Contract/Project/Site master data rules: every row here
    -- references the existing masters and is authorized through the single
    -- CustomerService.getAuthorized Data Scope choke point (ADR-0011).
    --
    -- Pricing is Tenant-authored configuration (price books), never a
    -- hardcoded per-client rate. Quotation lines snapshot the resolved unit
    -- price so a historical quotation stays auditable after a price book
    -- changes. Business history is soft-deleted only.
    -- -----------------------------------------------------------------------

    -- Price book: a Tenant-authored, optionally Customer-specific and
    -- date-effective set of unit prices over the existing service catalog.
    CREATE TABLE sales_price_books (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

      code                  TEXT        NOT NULL,
      name                  TEXT        NOT NULL,
      description           TEXT,
      currency_code         TEXT        NOT NULL,

      -- NULL customer_id = the Tenant-wide default book. A customer-specific
      -- book outranks it during deterministic price resolution.
      customer_id           UUID        REFERENCES customers(id) ON DELETE RESTRICT,

      effective_from        DATE        NOT NULL,
      effective_to          DATE,
      CHECK (effective_to IS NULL OR effective_to >= effective_from),

      is_active             BOOLEAN     NOT NULL DEFAULT true,

      created_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      deleted_at            TIMESTAMPTZ
    );

    CREATE UNIQUE INDEX sales_price_books_tenant_code_unique
      ON sales_price_books (tenant_id, code) WHERE deleted_at IS NULL;
    CREATE INDEX idx_sales_price_books_tenant ON sales_price_books (tenant_id) WHERE deleted_at IS NULL;
    CREATE INDEX idx_sales_price_books_customer
      ON sales_price_books (tenant_id, customer_id) WHERE customer_id IS NOT NULL AND deleted_at IS NULL;

    -- Carries its own tenant_id (not merely inherited through the parent) so
    -- every repository query can filter by tenant directly in SQL.
    CREATE TABLE sales_price_book_entries (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      price_book_id         UUID        NOT NULL REFERENCES sales_price_books(id) ON DELETE CASCADE,

      service_id            UUID        NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
      unit_code             TEXT        NOT NULL,
      unit_price            NUMERIC(18, 2) NOT NULL CHECK (unit_price >= 0),
      min_quantity          NUMERIC(18, 4) NOT NULL DEFAULT 1 CHECK (min_quantity > 0),

      created_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      deleted_at            TIMESTAMPTZ
    );

    CREATE UNIQUE INDEX sales_price_book_entries_unique
      ON sales_price_book_entries (price_book_id, service_id, min_quantity) WHERE deleted_at IS NULL;
    CREATE INDEX idx_sales_price_book_entries_book
      ON sales_price_book_entries (price_book_id) WHERE deleted_at IS NULL;

    -- Opportunity: the sales pipeline aggregate. Stage vocabulary is Tenant
    -- Reference Data (sales_opportunity_stage); only the coarse open/won/lost
    -- outcome is Product Core, because reporting and win-rate math need a
    -- deterministic terminal meaning that free-text stages cannot provide.
    CREATE TABLE sales_opportunities (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

      opportunity_number    TEXT        NOT NULL,
      customer_id           UUID        NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
      contract_id           UUID        REFERENCES contracts(id) ON DELETE SET NULL,
      project_id            UUID        REFERENCES projects(id) ON DELETE SET NULL,
      site_id               UUID        REFERENCES sites(id) ON DELETE SET NULL,
      customer_contact_id   UUID        REFERENCES customer_contacts(id) ON DELETE SET NULL,

      title                 TEXT        NOT NULL,
      description           TEXT,

      -- Tenant Reference Data codes (no catalog FK, matching the established
      -- Finance/HSE/Service Operations convention).
      stage_code            TEXT        NOT NULL,
      source_code           TEXT,

      outcome               TEXT        NOT NULL DEFAULT 'open'
        CHECK (outcome IN ('open', 'won', 'lost', 'cancelled')),
      outcome_reason        TEXT,
      closed_at             TIMESTAMPTZ,
      CHECK ((outcome = 'open') = (closed_at IS NULL)),

      currency_code         TEXT        NOT NULL,
      estimated_value       NUMERIC(18, 2) CHECK (estimated_value IS NULL OR estimated_value >= 0),
      probability_percent   INTEGER     CHECK (probability_percent IS NULL OR probability_percent BETWEEN 0 AND 100),
      expected_close_date   DATE,

      owner_user_id         UUID        REFERENCES users(id) ON DELETE SET NULL,

      created_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      deleted_at            TIMESTAMPTZ
    );

    CREATE UNIQUE INDEX sales_opportunities_tenant_number_unique
      ON sales_opportunities (tenant_id, opportunity_number);
    CREATE INDEX idx_sales_opportunities_tenant_customer
      ON sales_opportunities (tenant_id, customer_id) WHERE deleted_at IS NULL;
    CREATE INDEX idx_sales_opportunities_tenant_outcome
      ON sales_opportunities (tenant_id, outcome) WHERE deleted_at IS NULL;
    CREATE INDEX idx_sales_opportunities_tenant_stage
      ON sales_opportunities (tenant_id, stage_code) WHERE deleted_at IS NULL;

    -- Immutable stage-transition history: the pipeline audit trail. Rows are
    -- append-only by design (no update/delete path in the repository).
    CREATE TABLE sales_opportunity_stage_history (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      opportunity_id        UUID        NOT NULL REFERENCES sales_opportunities(id) ON DELETE CASCADE,

      from_stage_code       TEXT,
      to_stage_code         TEXT        NOT NULL,
      from_outcome          TEXT,
      to_outcome            TEXT        NOT NULL,
      note                  TEXT,

      changed_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      changed_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_sales_opportunity_stage_history_opportunity
      ON sales_opportunity_stage_history (opportunity_id, changed_at);

    -- Quotation: a versioned commercial offer against an Opportunity.
    -- Lifecycle beyond draft/sent is owned by the Workflow Engine through
    -- workflow_instance_id — this table holds no competing state machine,
    -- exactly as complaints does (ADR-0013).
    CREATE TABLE sales_quotations (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

      quotation_number      TEXT        NOT NULL,
      opportunity_id        UUID        NOT NULL REFERENCES sales_opportunities(id) ON DELETE RESTRICT,
      customer_id           UUID        NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
      price_book_id         UUID        REFERENCES sales_price_books(id) ON DELETE SET NULL,

      revision              INTEGER     NOT NULL DEFAULT 1 CHECK (revision >= 1),
      supersedes_quotation_id UUID      REFERENCES sales_quotations(id) ON DELETE SET NULL,

      title                 TEXT        NOT NULL,
      notes                 TEXT,
      currency_code         TEXT        NOT NULL,

      -- Recorded totals are derived from the immutable line snapshots and
      -- stored so a historical quotation reprints identically.
      subtotal_amount       NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
      discount_amount       NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
      tax_amount            NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
      total_amount          NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),

      valid_until           DATE,
      issued_at             TIMESTAMPTZ,

      status                TEXT        NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'in_approval', 'issued', 'accepted', 'declined', 'expired', 'withdrawn')),
      customer_decision_note TEXT,
      customer_decided_at   TIMESTAMPTZ,
      customer_decided_by   UUID        REFERENCES users(id) ON DELETE SET NULL,

      workflow_instance_id  UUID        REFERENCES workflow_instances(id) ON DELETE SET NULL,

      created_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      deleted_at            TIMESTAMPTZ
    );

    CREATE UNIQUE INDEX sales_quotations_tenant_number_unique
      ON sales_quotations (tenant_id, quotation_number);
    CREATE INDEX idx_sales_quotations_tenant_customer
      ON sales_quotations (tenant_id, customer_id) WHERE deleted_at IS NULL;
    CREATE INDEX idx_sales_quotations_opportunity
      ON sales_quotations (opportunity_id) WHERE deleted_at IS NULL;
    CREATE INDEX idx_sales_quotations_tenant_status
      ON sales_quotations (tenant_id, status) WHERE deleted_at IS NULL;
    CREATE INDEX idx_sales_quotations_workflow_instance
      ON sales_quotations (workflow_instance_id) WHERE workflow_instance_id IS NOT NULL;

    -- Quotation line: an immutable priced snapshot. unit_price is copied at
    -- composition time and never re-resolved, so editing a price book cannot
    -- retroactively rewrite an issued quotation.
    CREATE TABLE sales_quotation_lines (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      quotation_id          UUID        NOT NULL REFERENCES sales_quotations(id) ON DELETE CASCADE,

      line_number           INTEGER     NOT NULL CHECK (line_number >= 1),
      service_id            UUID        REFERENCES services(id) ON DELETE SET NULL,

      -- Snapshot columns: retained even if the catalog row is later renamed.
      service_code_snapshot TEXT        NOT NULL,
      service_name_snapshot TEXT        NOT NULL,
      description           TEXT,

      unit_code             TEXT        NOT NULL,
      quantity              NUMERIC(18, 4) NOT NULL CHECK (quantity > 0),
      unit_price            NUMERIC(18, 2) NOT NULL CHECK (unit_price >= 0),
      discount_amount       NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
      line_total            NUMERIC(18, 2) NOT NULL CHECK (line_total >= 0),

      -- How the unit price was determined, so a reviewer can explain it.
      price_source          TEXT        NOT NULL DEFAULT 'manual'
        CHECK (price_source IN ('price_book', 'manual')),
      price_book_entry_id   UUID        REFERENCES sales_price_book_entries(id) ON DELETE SET NULL,

      created_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX sales_quotation_lines_number_unique
      ON sales_quotation_lines (quotation_id, line_number);
    CREATE INDEX idx_sales_quotation_lines_quotation
      ON sales_quotation_lines (quotation_id);

    -- -----------------------------------------------------------------------
    -- Reference Data types (Product Core registers the TYPE only; a Tenant
    -- populates ITEMS through the existing /config/reference-data API. No
    -- client-specific or industry-specific values are seeded here.)
    -- -----------------------------------------------------------------------
    INSERT INTO reference_data_types (code, name, description)
    SELECT v.code, v.name, v.description
      FROM (VALUES
        ('sales_opportunity_stage', 'Sales Opportunity Stage', 'Tenant-configurable pipeline stage catalog for sales opportunities'),
        ('sales_opportunity_source', 'Sales Opportunity Source', 'Tenant-configurable origin catalog for sales opportunities'),
        ('sales_unit_of_measure', 'Sales Unit of Measure', 'Tenant-configurable unit catalog for quotation and price book lines')
      ) AS v(code, name, description)
     WHERE NOT EXISTS (SELECT 1 FROM reference_data_types t WHERE t.code = v.code);

    INSERT INTO permissions (code, description) VALUES
      ('sales.read',      'View sales opportunities, quotations, and pricing'),
      ('sales.manage',    'Create and maintain sales opportunities and quotations'),
      ('sales.configure', 'Maintain price books and sales pricing configuration'),
      ('sales.approve',   'Approve or reject quotations through the approval workflow')
    ON CONFLICT (code) DO NOTHING;

  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS sales_quotation_lines;
    DROP TABLE IF EXISTS sales_quotations;
    DROP TABLE IF EXISTS sales_opportunity_stage_history;
    DROP TABLE IF EXISTS sales_opportunities;
    DROP TABLE IF EXISTS sales_price_book_entries;
    DROP TABLE IF EXISTS sales_price_books;

    DELETE FROM reference_data_types
     WHERE code IN ('sales_opportunity_stage', 'sales_opportunity_source', 'sales_unit_of_measure');

    DELETE FROM permissions
     WHERE code IN ('sales.read', 'sales.manage', 'sales.configure', 'sales.approve');
  `);
};
