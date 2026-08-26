/**
 * Wave A1 / CUS-ADV-001 — Sales pipeline, quotation, and pricing.
 *
 * Deliberately mirrors the Complaint Engine's split of concerns: this
 * aggregate owns commercial DATA, while quotation approval LIFECYCLE is
 * delegated to the generic Workflow Engine through `workflowInstanceId`.
 * Customer authorization is never decided here — every read and write is
 * routed through `CustomerService.getAuthorized` (ADR-0011) by the
 * application service.
 */

export interface PriceBook {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  currencyCode: string;
  /** null = the Tenant-wide default book. */
  customerId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PriceBookEntry {
  id: string;
  tenantId: string;
  priceBookId: string;
  serviceId: string;
  unitCode: string;
  unitPrice: number;
  minQuantity: number;
  createdAt: Date;
  updatedAt: Date;
}

export type OpportunityOutcome = "open" | "won" | "lost" | "cancelled";

export interface Opportunity {
  id: string;
  tenantId: string;
  opportunityNumber: string;
  customerId: string;
  contractId: string | null;
  projectId: string | null;
  siteId: string | null;
  customerContactId: string | null;
  title: string;
  description: string | null;
  stageCode: string;
  sourceCode: string | null;
  outcome: OpportunityOutcome;
  outcomeReason: string | null;
  closedAt: Date | null;
  currencyCode: string;
  estimatedValue: number | null;
  probabilityPercent: number | null;
  expectedCloseDate: string | null;
  ownerUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OpportunityStageHistoryEntry {
  id: string;
  opportunityId: string;
  fromStageCode: string | null;
  toStageCode: string;
  fromOutcome: string | null;
  toOutcome: string;
  note: string | null;
  changedBy: string | null;
  changedAt: Date;
}

export type QuotationStatus =
  | "draft"
  | "in_approval"
  | "issued"
  | "accepted"
  | "declined"
  | "expired"
  | "withdrawn";

export interface Quotation {
  id: string;
  tenantId: string;
  quotationNumber: string;
  opportunityId: string;
  customerId: string;
  priceBookId: string | null;
  revision: number;
  supersedesQuotationId: string | null;
  title: string;
  notes: string | null;
  currencyCode: string;
  subtotalAmount: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  validUntil: string | null;
  issuedAt: Date | null;
  status: QuotationStatus;
  customerDecisionNote: string | null;
  customerDecidedAt: Date | null;
  customerDecidedBy: string | null;
  workflowInstanceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuotationLine {
  id: string;
  tenantId: string;
  quotationId: string;
  lineNumber: number;
  serviceId: string | null;
  serviceCodeSnapshot: string;
  serviceNameSnapshot: string;
  description: string | null;
  unitCode: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  lineTotal: number;
  priceSource: "price_book" | "manual";
  priceBookEntryId: string | null;
  createdAt: Date;
}

export interface CreatePriceBookInput {
  tenantId: string;
  code: string;
  name: string;
  description?: string | null;
  currencyCode: string;
  customerId?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export interface CreatePriceBookEntryInput {
  tenantId: string;
  priceBookId: string;
  serviceId: string;
  unitCode: string;
  unitPrice: number;
  minQuantity: number;
}

export interface CreateOpportunityInput {
  tenantId: string;
  opportunityNumber: string;
  customerId: string;
  contractId?: string | null;
  projectId?: string | null;
  siteId?: string | null;
  customerContactId?: string | null;
  title: string;
  description?: string | null;
  stageCode: string;
  sourceCode?: string | null;
  currencyCode: string;
  estimatedValue?: number | null;
  probabilityPercent?: number | null;
  expectedCloseDate?: string | null;
  ownerUserId?: string | null;
}

export interface UpdateOpportunityStageInput {
  stageCode: string;
  outcome: OpportunityOutcome;
  outcomeReason: string | null;
  note: string | null;
}

export interface CreateQuotationInput {
  tenantId: string;
  quotationNumber: string;
  opportunityId: string;
  customerId: string;
  priceBookId: string | null;
  revision: number;
  supersedesQuotationId: string | null;
  title: string;
  notes?: string | null;
  currencyCode: string;
  validUntil?: string | null;
  taxAmount: number;
}

export interface CreateQuotationLineInput {
  tenantId: string;
  quotationId: string;
  lineNumber: number;
  serviceId: string | null;
  serviceCodeSnapshot: string;
  serviceNameSnapshot: string;
  description: string | null;
  unitCode: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  /** No `lineTotal` — PostgreSQL derives it in exact numeric arithmetic so a
   *  money value never passes through binary floating point. */
  priceSource: "price_book" | "manual";
  priceBookEntryId: string | null;
}

export interface OpportunityPipelineRow {
  stageCode: string;
  outcome: OpportunityOutcome;
  opportunityCount: number;
  estimatedValueTotal: number;
  weightedValueTotal: number;
}

export interface SalesRepository {
  createPriceBook(input: CreatePriceBookInput, createdBy: string | null): Promise<PriceBook>;
  findPriceBookById(tenantId: string, id: string): Promise<PriceBook | null>;
  listPriceBooks(tenantId: string, customerIds: string[] | null): Promise<PriceBook[]>;
  deactivatePriceBook(tenantId: string, id: string, updatedBy: string | null): Promise<PriceBook>;

  createPriceBookEntry(
    input: CreatePriceBookEntryInput,
    createdBy: string | null,
  ): Promise<PriceBookEntry>;
  listPriceBookEntries(tenantId: string, priceBookId: string): Promise<PriceBookEntry[]>;
  findPriceBookEntryById(tenantId: string, id: string): Promise<PriceBookEntry | null>;
  /**
   * Deterministic price resolution: the best-matching entry for a service
   * and quantity within one book. Ordering is explicit so the same inputs
   * always produce the same price.
   */
  resolvePriceBookEntry(
    tenantId: string,
    priceBookId: string,
    serviceId: string,
    quantity: number,
  ): Promise<PriceBookEntry | null>;
  /**
   * Candidate books for a Customer on a date, most specific first: a
   * customer-specific book outranks the Tenant-wide default.
   */
  findApplicablePriceBooks(
    tenantId: string,
    customerId: string,
    onDate: string,
  ): Promise<PriceBook[]>;

  createOpportunity(input: CreateOpportunityInput, createdBy: string | null): Promise<Opportunity>;
  findOpportunityById(tenantId: string, id: string): Promise<Opportunity | null>;
  listOpportunities(
    tenantId: string,
    customerIds: string[],
    filters: { outcome?: OpportunityOutcome; stageCode?: string; customerId?: string },
  ): Promise<Opportunity[]>;
  updateOpportunityStage(
    tenantId: string,
    id: string,
    input: UpdateOpportunityStageInput,
    updatedBy: string | null,
  ): Promise<Opportunity>;
  appendOpportunityStageHistory(
    tenantId: string,
    opportunityId: string,
    entry: Omit<UpdateOpportunityStageInput, "outcomeReason"> & {
      fromStageCode: string | null;
      fromOutcome: string | null;
    },
    changedBy: string | null,
  ): Promise<void>;
  listOpportunityStageHistory(
    tenantId: string,
    opportunityId: string,
  ): Promise<OpportunityStageHistoryEntry[]>;
  summarisePipeline(tenantId: string, customerIds: string[]): Promise<OpportunityPipelineRow[]>;

  createQuotation(input: CreateQuotationInput, createdBy: string | null): Promise<Quotation>;
  findQuotationById(tenantId: string, id: string): Promise<Quotation | null>;
  listQuotationsByOpportunity(tenantId: string, opportunityId: string): Promise<Quotation[]>;
  listQuotationsByCustomers(tenantId: string, customerIds: string[]): Promise<Quotation[]>;
  latestRevisionForOpportunity(tenantId: string, opportunityId: string): Promise<number>;
  createQuotationLine(
    input: CreateQuotationLineInput,
    createdBy: string | null,
  ): Promise<QuotationLine>;
  listQuotationLines(tenantId: string, quotationId: string): Promise<QuotationLine[]>;
  recalculateQuotationTotals(
    tenantId: string,
    quotationId: string,
    updatedBy: string | null,
  ): Promise<Quotation>;
  setQuotationWorkflowInstance(
    tenantId: string,
    id: string,
    workflowInstanceId: string,
  ): Promise<void>;
  updateQuotationStatus(
    tenantId: string,
    id: string,
    status: QuotationStatus,
    updatedBy: string | null,
    extra?: { issuedAt?: Date; decisionNote?: string | null; decidedBy?: string | null },
  ): Promise<Quotation>;
}
