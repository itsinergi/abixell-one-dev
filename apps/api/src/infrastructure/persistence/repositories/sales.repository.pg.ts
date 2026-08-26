import type { Pool } from "pg";
import type {
  CreateOpportunityInput,
  CreatePriceBookEntryInput,
  CreatePriceBookInput,
  CreateQuotationInput,
  CreateQuotationLineInput,
  Opportunity,
  OpportunityOutcome,
  OpportunityPipelineRow,
  OpportunityStageHistoryEntry,
  PriceBook,
  PriceBookEntry,
  Quotation,
  QuotationLine,
  QuotationStatus,
  SalesRepository,
  UpdateOpportunityStageInput,
} from "../../../domain/sales/sales.entity.js";

/** Postgres NUMERIC comes back as a string to preserve precision; every
 * money/quantity column is normalised here once so no caller has to. */
function num(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

function optionalNum(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** DATE columns are read as plain YYYY-MM-DD so a business date never
 * drifts through a timezone conversion. */
function dateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPriceBook(row: any): PriceBook {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    description: row.description,
    currencyCode: row.currency_code,
    customerId: row.customer_id,
    effectiveFrom: dateOnly(row.effective_from)!,
    effectiveTo: dateOnly(row.effective_to),
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPriceBookEntry(row: any): PriceBookEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    priceBookId: row.price_book_id,
    serviceId: row.service_id,
    unitCode: row.unit_code,
    unitPrice: num(row.unit_price),
    minQuantity: num(row.min_quantity),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapOpportunity(row: any): Opportunity {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    opportunityNumber: row.opportunity_number,
    customerId: row.customer_id,
    contractId: row.contract_id,
    projectId: row.project_id,
    siteId: row.site_id,
    customerContactId: row.customer_contact_id,
    title: row.title,
    description: row.description,
    stageCode: row.stage_code,
    sourceCode: row.source_code,
    outcome: row.outcome as OpportunityOutcome,
    outcomeReason: row.outcome_reason,
    closedAt: row.closed_at,
    currencyCode: row.currency_code,
    estimatedValue: optionalNum(row.estimated_value),
    probabilityPercent: row.probability_percent === null ? null : Number(row.probability_percent),
    expectedCloseDate: dateOnly(row.expected_close_date),
    ownerUserId: row.owner_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapQuotation(row: any): Quotation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    quotationNumber: row.quotation_number,
    opportunityId: row.opportunity_id,
    customerId: row.customer_id,
    priceBookId: row.price_book_id,
    revision: Number(row.revision),
    supersedesQuotationId: row.supersedes_quotation_id,
    title: row.title,
    notes: row.notes,
    currencyCode: row.currency_code,
    subtotalAmount: num(row.subtotal_amount),
    discountAmount: num(row.discount_amount),
    taxAmount: num(row.tax_amount),
    totalAmount: num(row.total_amount),
    validUntil: dateOnly(row.valid_until),
    issuedAt: row.issued_at,
    status: row.status as QuotationStatus,
    customerDecisionNote: row.customer_decision_note,
    customerDecidedAt: row.customer_decided_at,
    customerDecidedBy: row.customer_decided_by,
    workflowInstanceId: row.workflow_instance_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapQuotationLine(row: any): QuotationLine {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    quotationId: row.quotation_id,
    lineNumber: Number(row.line_number),
    serviceId: row.service_id,
    serviceCodeSnapshot: row.service_code_snapshot,
    serviceNameSnapshot: row.service_name_snapshot,
    description: row.description,
    unitCode: row.unit_code,
    quantity: num(row.quantity),
    unitPrice: num(row.unit_price),
    discountAmount: num(row.discount_amount),
    lineTotal: num(row.line_total),
    priceSource: row.price_source,
    priceBookEntryId: row.price_book_entry_id,
    createdAt: row.created_at,
  };
}

/**
 * Every statement filters on `tenant_id` directly — no query relies on a
 * parent join for isolation, which is why each child table carries its own
 * tenant column.
 */
export class PgSalesRepository implements SalesRepository {
  constructor(private readonly pool: Pool) {}

  // --- price books -------------------------------------------------------

  async createPriceBook(input: CreatePriceBookInput, createdBy: string | null): Promise<PriceBook> {
    const result = await this.pool.query(
      `INSERT INTO sales_price_books
         (tenant_id, code, name, description, currency_code, customer_id,
          effective_from, effective_to, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       RETURNING *`,
      [
        input.tenantId,
        input.code,
        input.name,
        input.description ?? null,
        input.currencyCode,
        input.customerId ?? null,
        input.effectiveFrom,
        input.effectiveTo ?? null,
        createdBy,
      ],
    );
    return mapPriceBook(result.rows[0]);
  }

  async findPriceBookById(tenantId: string, id: string): Promise<PriceBook | null> {
    const result = await this.pool.query(
      `SELECT * FROM sales_price_books WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    return result.rows[0] ? mapPriceBook(result.rows[0]) : null;
  }

  /** `customerIds === null` means the caller holds Tenant scope; otherwise
   * only Tenant-wide books plus books for in-scope Customers are visible. */
  async listPriceBooks(tenantId: string, customerIds: string[] | null): Promise<PriceBook[]> {
    if (customerIds === null) {
      const result = await this.pool.query(
        `SELECT * FROM sales_price_books
          WHERE tenant_id = $1 AND deleted_at IS NULL
          ORDER BY code`,
        [tenantId],
      );
      return result.rows.map(mapPriceBook);
    }
    const result = await this.pool.query(
      `SELECT * FROM sales_price_books
        WHERE tenant_id = $1 AND deleted_at IS NULL
          AND (customer_id IS NULL OR customer_id = ANY($2::uuid[]))
        ORDER BY code`,
      [tenantId, customerIds],
    );
    return result.rows.map(mapPriceBook);
  }

  async deactivatePriceBook(
    tenantId: string,
    id: string,
    updatedBy: string | null,
  ): Promise<PriceBook> {
    const result = await this.pool.query(
      `UPDATE sales_price_books
          SET is_active = false, updated_by = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        RETURNING *`,
      [tenantId, id, updatedBy],
    );
    return mapPriceBook(result.rows[0]);
  }

  async createPriceBookEntry(
    input: CreatePriceBookEntryInput,
    createdBy: string | null,
  ): Promise<PriceBookEntry> {
    const result = await this.pool.query(
      `INSERT INTO sales_price_book_entries
         (tenant_id, price_book_id, service_id, unit_code, unit_price, min_quantity, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       RETURNING *`,
      [
        input.tenantId,
        input.priceBookId,
        input.serviceId,
        input.unitCode,
        input.unitPrice,
        input.minQuantity,
        createdBy,
      ],
    );
    return mapPriceBookEntry(result.rows[0]);
  }

  async listPriceBookEntries(tenantId: string, priceBookId: string): Promise<PriceBookEntry[]> {
    const result = await this.pool.query(
      `SELECT * FROM sales_price_book_entries
        WHERE tenant_id = $1 AND price_book_id = $2 AND deleted_at IS NULL
        ORDER BY service_id, min_quantity`,
      [tenantId, priceBookId],
    );
    return result.rows.map(mapPriceBookEntry);
  }

  async findPriceBookEntryById(tenantId: string, id: string): Promise<PriceBookEntry | null> {
    const result = await this.pool.query(
      `SELECT * FROM sales_price_book_entries
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    return result.rows[0] ? mapPriceBookEntry(result.rows[0]) : null;
  }

  async resolvePriceBookEntry(
    tenantId: string,
    priceBookId: string,
    serviceId: string,
    quantity: number,
  ): Promise<PriceBookEntry | null> {
    // Highest min_quantity that the ordered quantity still satisfies —
    // i.e. the applicable volume tier. `id` breaks any residual tie so the
    // result is stable across identical rows.
    const result = await this.pool.query(
      `SELECT * FROM sales_price_book_entries
        WHERE tenant_id = $1 AND price_book_id = $2 AND service_id = $3
          AND min_quantity <= $4 AND deleted_at IS NULL
        ORDER BY min_quantity DESC, id
        LIMIT 1`,
      [tenantId, priceBookId, serviceId, quantity],
    );
    return result.rows[0] ? mapPriceBookEntry(result.rows[0]) : null;
  }

  async findApplicablePriceBooks(
    tenantId: string,
    customerId: string,
    onDate: string,
  ): Promise<PriceBook[]> {
    const result = await this.pool.query(
      `SELECT * FROM sales_price_books
        WHERE tenant_id = $1
          AND is_active = true
          AND deleted_at IS NULL
          AND (customer_id = $2 OR customer_id IS NULL)
          AND effective_from <= $3::date
          AND (effective_to IS NULL OR effective_to >= $3::date)
        ORDER BY (customer_id IS NULL), effective_from DESC, code`,
      [tenantId, customerId, onDate],
    );
    return result.rows.map(mapPriceBook);
  }

  // --- opportunities -----------------------------------------------------

  async createOpportunity(
    input: CreateOpportunityInput,
    createdBy: string | null,
  ): Promise<Opportunity> {
    const result = await this.pool.query(
      `INSERT INTO sales_opportunities
         (tenant_id, opportunity_number, customer_id, contract_id, project_id, site_id,
          customer_contact_id, title, description, stage_code, source_code, currency_code,
          estimated_value, probability_percent, expected_close_date, owner_user_id,
          created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)
       RETURNING *`,
      [
        input.tenantId,
        input.opportunityNumber,
        input.customerId,
        input.contractId ?? null,
        input.projectId ?? null,
        input.siteId ?? null,
        input.customerContactId ?? null,
        input.title,
        input.description ?? null,
        input.stageCode,
        input.sourceCode ?? null,
        input.currencyCode,
        input.estimatedValue ?? null,
        input.probabilityPercent ?? null,
        input.expectedCloseDate ?? null,
        input.ownerUserId ?? null,
        createdBy,
      ],
    );
    return mapOpportunity(result.rows[0]);
  }

  async findOpportunityById(tenantId: string, id: string): Promise<Opportunity | null> {
    const result = await this.pool.query(
      `SELECT * FROM sales_opportunities WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    return result.rows[0] ? mapOpportunity(result.rows[0]) : null;
  }

  async listOpportunities(
    tenantId: string,
    customerIds: string[],
    filters: { outcome?: OpportunityOutcome; stageCode?: string; customerId?: string },
  ): Promise<Opportunity[]> {
    if (customerIds.length === 0) return [];
    const result = await this.pool.query(
      `SELECT * FROM sales_opportunities
        WHERE tenant_id = $1
          AND deleted_at IS NULL
          AND customer_id = ANY($2::uuid[])
          AND ($3::text IS NULL OR outcome = $3)
          AND ($4::text IS NULL OR stage_code = $4)
          AND ($5::uuid IS NULL OR customer_id = $5)
        ORDER BY created_at DESC`,
      [
        tenantId,
        customerIds,
        filters.outcome ?? null,
        filters.stageCode ?? null,
        filters.customerId ?? null,
      ],
    );
    return result.rows.map(mapOpportunity);
  }

  async updateOpportunityStage(
    tenantId: string,
    id: string,
    input: UpdateOpportunityStageInput,
    updatedBy: string | null,
  ): Promise<Opportunity> {
    // `closed_at` is derived from the outcome, never supplied by a caller,
    // so the table's `(outcome = 'open') = (closed_at IS NULL)` invariant
    // cannot be violated through the API.
    const result = await this.pool.query(
      `UPDATE sales_opportunities
          SET stage_code = $3,
              outcome = $4,
              outcome_reason = $5,
              closed_at = CASE WHEN $4 = 'open' THEN NULL ELSE COALESCE(closed_at, now()) END,
              updated_by = $6,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        RETURNING *`,
      [tenantId, id, input.stageCode, input.outcome, input.outcomeReason, updatedBy],
    );
    return mapOpportunity(result.rows[0]);
  }

  async appendOpportunityStageHistory(
    tenantId: string,
    opportunityId: string,
    entry: {
      stageCode: string;
      outcome: OpportunityOutcome;
      note: string | null;
      fromStageCode: string | null;
      fromOutcome: string | null;
    },
    changedBy: string | null,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO sales_opportunity_stage_history
         (tenant_id, opportunity_id, from_stage_code, to_stage_code, from_outcome, to_outcome, note, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        tenantId,
        opportunityId,
        entry.fromStageCode,
        entry.stageCode,
        entry.fromOutcome,
        entry.outcome,
        entry.note,
        changedBy,
      ],
    );
  }

  async listOpportunityStageHistory(
    tenantId: string,
    opportunityId: string,
  ): Promise<OpportunityStageHistoryEntry[]> {
    const result = await this.pool.query(
      `SELECT * FROM sales_opportunity_stage_history
        WHERE tenant_id = $1 AND opportunity_id = $2
        ORDER BY changed_at, id`,
      [tenantId, opportunityId],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result.rows.map((row: any) => ({
      id: row.id,
      opportunityId: row.opportunity_id,
      fromStageCode: row.from_stage_code,
      toStageCode: row.to_stage_code,
      fromOutcome: row.from_outcome,
      toOutcome: row.to_outcome,
      note: row.note,
      changedBy: row.changed_by,
      changedAt: row.changed_at,
    }));
  }

  async summarisePipeline(
    tenantId: string,
    customerIds: string[],
  ): Promise<OpportunityPipelineRow[]> {
    if (customerIds.length === 0) return [];
    // Weighted value uses the recorded probability; a missing probability
    // contributes zero weight rather than silently assuming certainty.
    const result = await this.pool.query(
      `SELECT stage_code,
              outcome,
              COUNT(*)::int                                              AS opportunity_count,
              COALESCE(SUM(estimated_value), 0)                          AS estimated_value_total,
              COALESCE(SUM(estimated_value * COALESCE(probability_percent, 0) / 100.0), 0)
                                                                         AS weighted_value_total
         FROM sales_opportunities
        WHERE tenant_id = $1 AND deleted_at IS NULL AND customer_id = ANY($2::uuid[])
        GROUP BY stage_code, outcome
        ORDER BY stage_code, outcome`,
      [tenantId, customerIds],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result.rows.map((row: any) => ({
      stageCode: row.stage_code,
      outcome: row.outcome as OpportunityOutcome,
      opportunityCount: Number(row.opportunity_count),
      estimatedValueTotal: num(row.estimated_value_total),
      weightedValueTotal: num(row.weighted_value_total),
    }));
  }

  // --- quotations --------------------------------------------------------

  async createQuotation(
    input: CreateQuotationInput,
    createdBy: string | null,
  ): Promise<Quotation> {
    const result = await this.pool.query(
      `INSERT INTO sales_quotations
         (tenant_id, quotation_number, opportunity_id, customer_id, price_book_id, revision,
          supersedes_quotation_id, title, notes, currency_code, valid_until, tax_amount,
          created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
       RETURNING *`,
      [
        input.tenantId,
        input.quotationNumber,
        input.opportunityId,
        input.customerId,
        input.priceBookId,
        input.revision,
        input.supersedesQuotationId,
        input.title,
        input.notes ?? null,
        input.currencyCode,
        input.validUntil ?? null,
        input.taxAmount,
        createdBy,
      ],
    );
    return mapQuotation(result.rows[0]);
  }

  async findQuotationById(tenantId: string, id: string): Promise<Quotation | null> {
    const result = await this.pool.query(
      `SELECT * FROM sales_quotations WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );
    return result.rows[0] ? mapQuotation(result.rows[0]) : null;
  }

  async listQuotationsByOpportunity(
    tenantId: string,
    opportunityId: string,
  ): Promise<Quotation[]> {
    const result = await this.pool.query(
      `SELECT * FROM sales_quotations
        WHERE tenant_id = $1 AND opportunity_id = $2 AND deleted_at IS NULL
        ORDER BY revision DESC`,
      [tenantId, opportunityId],
    );
    return result.rows.map(mapQuotation);
  }

  async listQuotationsByCustomers(tenantId: string, customerIds: string[]): Promise<Quotation[]> {
    if (customerIds.length === 0) return [];
    const result = await this.pool.query(
      `SELECT * FROM sales_quotations
        WHERE tenant_id = $1 AND deleted_at IS NULL AND customer_id = ANY($2::uuid[])
        ORDER BY created_at DESC`,
      [tenantId, customerIds],
    );
    return result.rows.map(mapQuotation);
  }

  async latestRevisionForOpportunity(tenantId: string, opportunityId: string): Promise<number> {
    const result = await this.pool.query(
      `SELECT COALESCE(MAX(revision), 0)::int AS latest
         FROM sales_quotations
        WHERE tenant_id = $1 AND opportunity_id = $2`,
      [tenantId, opportunityId],
    );
    return Number(result.rows[0].latest);
  }

  async createQuotationLine(
    input: CreateQuotationLineInput,
    createdBy: string | null,
  ): Promise<QuotationLine> {
    const result = await this.pool.query(
      `INSERT INTO sales_quotation_lines
         (tenant_id, quotation_id, line_number, service_id, service_code_snapshot,
          service_name_snapshot, description, unit_code, quantity, unit_price,
          discount_amount, line_total, price_source, price_book_entry_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        input.tenantId,
        input.quotationId,
        input.lineNumber,
        input.serviceId,
        input.serviceCodeSnapshot,
        input.serviceNameSnapshot,
        input.description,
        input.unitCode,
        input.quantity,
        input.unitPrice,
        input.discountAmount,
        input.lineTotal,
        input.priceSource,
        input.priceBookEntryId,
        createdBy,
      ],
    );
    return mapQuotationLine(result.rows[0]);
  }

  async listQuotationLines(tenantId: string, quotationId: string): Promise<QuotationLine[]> {
    const result = await this.pool.query(
      `SELECT * FROM sales_quotation_lines
        WHERE tenant_id = $1 AND quotation_id = $2
        ORDER BY line_number`,
      [tenantId, quotationId],
    );
    return result.rows.map(mapQuotationLine);
  }

  async recalculateQuotationTotals(
    tenantId: string,
    quotationId: string,
    updatedBy: string | null,
  ): Promise<Quotation> {
    // Totals are recomputed from the immutable line snapshots in one
    // statement, so a header can never disagree with its own lines.
    const result = await this.pool.query(
      `UPDATE sales_quotations q
          SET subtotal_amount = agg.subtotal,
              discount_amount = agg.discount,
              total_amount    = GREATEST(agg.subtotal - agg.discount + q.tax_amount, 0),
              updated_by      = $3,
              updated_at      = now()
         FROM (
           SELECT COALESCE(SUM(quantity * unit_price), 0) AS subtotal,
                  COALESCE(SUM(discount_amount), 0)       AS discount
             FROM sales_quotation_lines
            WHERE tenant_id = $1 AND quotation_id = $2
         ) AS agg
        WHERE q.tenant_id = $1 AND q.id = $2 AND q.deleted_at IS NULL
        RETURNING q.*`,
      [tenantId, quotationId, updatedBy],
    );
    return mapQuotation(result.rows[0]);
  }

  async setQuotationWorkflowInstance(
    tenantId: string,
    id: string,
    workflowInstanceId: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE sales_quotations SET workflow_instance_id = $3
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, workflowInstanceId],
    );
  }

  async updateQuotationStatus(
    tenantId: string,
    id: string,
    status: QuotationStatus,
    updatedBy: string | null,
    extra?: { issuedAt?: Date; decisionNote?: string | null; decidedBy?: string | null },
  ): Promise<Quotation> {
    const result = await this.pool.query(
      `UPDATE sales_quotations
          SET status = $3,
              issued_at = COALESCE($4, issued_at),
              customer_decision_note = COALESCE($5, customer_decision_note),
              customer_decided_by = COALESCE($6, customer_decided_by),
              customer_decided_at = CASE WHEN $6::uuid IS NULL THEN customer_decided_at ELSE now() END,
              updated_by = $7,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        RETURNING *`,
      [
        tenantId,
        id,
        status,
        extra?.issuedAt ?? null,
        extra?.decisionNote ?? null,
        extra?.decidedBy ?? null,
        updatedBy,
      ],
    );
    return mapQuotation(result.rows[0]);
  }
}
