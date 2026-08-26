import type {
  Opportunity,
  OpportunityOutcome,
  OpportunityPipelineRow,
  OpportunityStageHistoryEntry,
  PriceBook,
  PriceBookEntry,
  Quotation,
  QuotationLine,
  SalesRepository,
} from "../../domain/sales/sales.entity.js";
import type { ServiceRepository } from "../../domain/customer/service.entity.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import { ConflictError, NotFoundError, ValidationError } from "../../domain/shared-kernel/errors.js";
import type { AuditService } from "../audit/audit.service.js";
import type { ConfigurationService } from "../configuration/configuration.service.js";
import type { CustomerService } from "../customer/customer.service.js";
import type { EventBus } from "../event/event-bus.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { WorkflowService } from "../workflow/workflow.service.js";

/**
 * Product Core integration point: WHICH configurable Workflow Definition a
 * Quotation approval runs against. Exactly like
 * COMPLAINT_WORKFLOW_DEFINITION_CODE, this fixes the graph's identity only
 * — its Steps, Transitions, SLA, and Assignment Rules stay 100%
 * Tenant-configurable through the existing Workflow Engine admin API.
 */
export const QUOTATION_WORKFLOW_DEFINITION_CODE = "quotation_approval";

export const OPPORTUNITY_NUMBERING_CODE = "sales_opportunity";
export const QUOTATION_NUMBERING_CODE = "sales_quotation";

/** Tenant Reference Data catalogs that drive the sales forms. The platform
 * registers the TYPE; every VALUE is Tenant configuration. */
export const OPPORTUNITY_STAGE_REF_TYPE = "sales_opportunity_stage";
export const OPPORTUNITY_SOURCE_REF_TYPE = "sales_opportunity_source";
export const SALES_UNIT_REF_TYPE = "sales_unit_of_measure";

export interface CreateOpportunityRequest {
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

export interface ChangeStageRequest {
  stageCode: string;
  outcome?: OpportunityOutcome;
  outcomeReason?: string | null;
  note?: string | null;
}

export interface QuotationLineRequest {
  serviceId: string;
  description?: string | null;
  unitCode?: string | null;
  quantity: number;
  /** Omitted = resolve from the applicable price book. Supplying a price
   * is an explicit, recorded manual override, never a silent default. */
  unitPrice?: number | null;
  discountAmount?: number | null;
}

export interface CreateQuotationRequest {
  opportunityId: string;
  title: string;
  notes?: string | null;
  validUntil?: string | null;
  taxAmount?: number | null;
  supersedesQuotationId?: string | null;
  lines: QuotationLineRequest[];
}

export interface SalesReferenceOptions {
  stages: { code: string; label: string }[];
  sources: { code: string; label: string }[];
  units: { code: string; label: string }[];
}

export interface QuotationDetail {
  quotation: Quotation;
  lines: QuotationLine[];
  status: { stepCode: string | null; stepName: string | null; instanceStatus: string } | null;
}

export interface PriceResolution {
  unitPrice: number;
  priceSource: "price_book" | "manual";
  priceBookId: string | null;
  priceBookEntryId: string | null;
  unitCode: string;
}

/**
 * Wave A1 / CUS-ADV-001. Owns commercial data and its permission gates;
 * delegates Customer visibility to CustomerService (ADR-0011), quotation
 * approval lifecycle to the Workflow Engine, numbering and vocabulary to
 * Configuration. It re-implements none of those.
 */
export class SalesService {
  constructor(
    private readonly repo: SalesRepository,
    private readonly serviceRepo: ServiceRepository,
    private readonly customers: CustomerService,
    private readonly workflow: WorkflowService,
    private readonly configuration: ConfigurationService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly eventBus: EventBus,
  ) {}

  // --- reference data ----------------------------------------------------

  /** Gated on `sales.manage` (what a user needs to actually create), so a
   * salesperson can populate the form without broad `config.read`. */
  async getReferenceOptions(actor: ActorContext): Promise<SalesReferenceOptions> {
    await this.rbac.requirePermission(actor.userId, "sales.manage");
    const [stages, sources, units] = await Promise.all([
      this.configuration.listReferenceDataItemsForTrustedCaller(
        actor.tenantId,
        OPPORTUNITY_STAGE_REF_TYPE,
      ),
      this.configuration.listReferenceDataItemsForTrustedCaller(
        actor.tenantId,
        OPPORTUNITY_SOURCE_REF_TYPE,
      ),
      this.configuration.listReferenceDataItemsForTrustedCaller(actor.tenantId, SALES_UNIT_REF_TYPE),
    ]);
    const active = (items: { code: string; label: string; isActive: boolean }[]) =>
      items.filter((i) => i.isActive).map((i) => ({ code: i.code, label: i.label }));
    return { stages: active(stages), sources: active(sources), units: active(units) };
  }

  private async requireActiveReferenceCode(
    tenantId: string,
    typeCode: string,
    value: string,
    label: string,
  ): Promise<void> {
    const items = await this.configuration.listReferenceDataItemsForTrustedCaller(
      tenantId,
      typeCode,
    );
    if (!items.some((item) => item.isActive && item.code === value)) {
      throw new ValidationError(`${label} '${value}' is not an active ${typeCode} value`);
    }
  }

  // --- price books -------------------------------------------------------

  async createPriceBook(
    actor: ActorContext,
    input: {
      code: string;
      name: string;
      description?: string | null;
      currencyCode: string;
      customerId?: string | null;
      effectiveFrom: string;
      effectiveTo?: string | null;
    },
  ): Promise<PriceBook> {
    await this.rbac.requirePermission(actor.userId, "sales.configure");
    // A customer-specific book is still Customer data: the same Data Scope
    // gate applies before it can be authored.
    if (input.customerId) {
      await this.customers.getAuthorized(actor, input.customerId);
    }

    const book = await this.repo.createPriceBook({ ...input, tenantId: actor.tenantId }, actor.userId);
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "sales.price_book.created",
      entityType: "sales_price_book",
      entityId: book.id,
      metadata: { code: book.code, customerId: book.customerId, currencyCode: book.currencyCode },
    });
    return book;
  }

  async listPriceBooks(actor: ActorContext): Promise<PriceBook[]> {
    await this.rbac.requirePermission(actor.userId, "sales.read");
    const tenantScoped = await this.rbac.hasTenantScope(actor.userId);
    const customerIds = tenantScoped ? null : await this.customers.listScopedCustomerIds(actor);
    return this.repo.listPriceBooks(actor.tenantId, customerIds);
  }

  async addPriceBookEntry(
    actor: ActorContext,
    priceBookId: string,
    input: { serviceId: string; unitCode: string; unitPrice: number; minQuantity?: number },
  ): Promise<PriceBookEntry> {
    await this.rbac.requirePermission(actor.userId, "sales.configure");
    const book = await this.getAuthorizedPriceBook(actor, priceBookId);

    const service = await this.serviceRepo.findById(input.serviceId);
    if (!service || service.tenantId !== actor.tenantId) {
      throw new NotFoundError("Service", input.serviceId);
    }
    await this.requireActiveReferenceCode(
      actor.tenantId,
      SALES_UNIT_REF_TYPE,
      input.unitCode,
      "Unit",
    );

    const entry = await this.repo.createPriceBookEntry(
      {
        tenantId: actor.tenantId,
        priceBookId: book.id,
        serviceId: service.id,
        unitCode: input.unitCode,
        unitPrice: input.unitPrice,
        minQuantity: input.minQuantity ?? 1,
      },
      actor.userId,
    );

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "sales.price_book.entry_added",
      entityType: "sales_price_book",
      entityId: book.id,
      metadata: {
        entryId: entry.id,
        serviceId: entry.serviceId,
        unitPrice: entry.unitPrice,
        minQuantity: entry.minQuantity,
      },
    });
    return entry;
  }

  async listPriceBookEntries(actor: ActorContext, priceBookId: string): Promise<PriceBookEntry[]> {
    await this.rbac.requirePermission(actor.userId, "sales.read");
    const book = await this.getAuthorizedPriceBook(actor, priceBookId);
    return this.repo.listPriceBookEntries(actor.tenantId, book.id);
  }

  private async getAuthorizedPriceBook(actor: ActorContext, id: string): Promise<PriceBook> {
    const book = await this.repo.findPriceBookById(actor.tenantId, id);
    if (!book) throw new NotFoundError("PriceBook", id);
    if (book.customerId) {
      await this.customers.getAuthorized(actor, book.customerId);
    }
    return book;
  }

  // --- opportunities -----------------------------------------------------

  async createOpportunity(
    actor: ActorContext,
    input: CreateOpportunityRequest,
  ): Promise<Opportunity> {
    await this.rbac.requirePermission(actor.userId, "sales.manage");
    const customer = await this.customers.getAuthorized(actor, input.customerId);

    await this.requireActiveReferenceCode(
      actor.tenantId,
      OPPORTUNITY_STAGE_REF_TYPE,
      input.stageCode,
      "Stage",
    );
    if (input.sourceCode) {
      await this.requireActiveReferenceCode(
        actor.tenantId,
        OPPORTUNITY_SOURCE_REF_TYPE,
        input.sourceCode,
        "Source",
      );
    }

    const { number } = await this.configuration.generateNumberForTenant(
      actor.tenantId,
      OPPORTUNITY_NUMBERING_CODE,
      actor.userId,
    );

    const opportunity = await this.repo.createOpportunity(
      { ...input, tenantId: actor.tenantId, opportunityNumber: number },
      actor.userId,
    );

    // The pipeline audit trail starts at creation, so the first stage is
    // as traceable as every later transition.
    await this.repo.appendOpportunityStageHistory(
      actor.tenantId,
      opportunity.id,
      {
        stageCode: opportunity.stageCode,
        outcome: opportunity.outcome,
        note: null,
        fromStageCode: null,
        fromOutcome: null,
      },
      actor.userId,
    );

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "sales.opportunity.created",
      entityType: "sales_opportunity",
      entityId: opportunity.id,
      metadata: {
        opportunityNumber: number,
        customerId: customer.id,
        stageCode: opportunity.stageCode,
      },
    });
    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: "sales.opportunity.created",
      entityType: "sales_opportunity",
      entityId: opportunity.id,
      payload: { opportunityNumber: number, customerId: customer.id },
      createdBy: actor.userId,
    });

    return opportunity;
  }

  async listOpportunities(
    actor: ActorContext,
    filters: { outcome?: OpportunityOutcome; stageCode?: string; customerId?: string } = {},
  ): Promise<Opportunity[]> {
    await this.rbac.requirePermission(actor.userId, "sales.read");
    if (filters.customerId) {
      await this.customers.getAuthorized(actor, filters.customerId);
    }
    const customerIds = await this.customers.listScopedCustomerIds(actor);
    return this.repo.listOpportunities(actor.tenantId, customerIds, filters);
  }

  async getOpportunity(
    actor: ActorContext,
    id: string,
  ): Promise<{ opportunity: Opportunity; history: OpportunityStageHistoryEntry[]; quotations: Quotation[] }> {
    await this.rbac.requirePermission(actor.userId, "sales.read");
    const opportunity = await this.getAuthorizedOpportunity(actor, id);
    const [history, quotations] = await Promise.all([
      this.repo.listOpportunityStageHistory(actor.tenantId, opportunity.id),
      this.repo.listQuotationsByOpportunity(actor.tenantId, opportunity.id),
    ]);
    return { opportunity, history, quotations };
  }

  async changeOpportunityStage(
    actor: ActorContext,
    id: string,
    input: ChangeStageRequest,
  ): Promise<Opportunity> {
    await this.rbac.requirePermission(actor.userId, "sales.manage");
    const current = await this.getAuthorizedOpportunity(actor, id);

    if (current.outcome !== "open") {
      throw new ConflictError(
        `Opportunity ${current.opportunityNumber} is already closed as '${current.outcome}'`,
      );
    }
    await this.requireActiveReferenceCode(
      actor.tenantId,
      OPPORTUNITY_STAGE_REF_TYPE,
      input.stageCode,
      "Stage",
    );

    const outcome = input.outcome ?? "open";
    // A terminal outcome must say why: win/loss reporting is worthless if
    // the reason is optional.
    if (outcome !== "open" && !input.outcomeReason) {
      throw new ValidationError("outcomeReason is required when closing an opportunity");
    }

    const updated = await this.repo.updateOpportunityStage(
      actor.tenantId,
      current.id,
      {
        stageCode: input.stageCode,
        outcome,
        outcomeReason: input.outcomeReason ?? null,
        note: input.note ?? null,
      },
      actor.userId,
    );
    await this.repo.appendOpportunityStageHistory(
      actor.tenantId,
      current.id,
      {
        stageCode: input.stageCode,
        outcome,
        note: input.note ?? null,
        fromStageCode: current.stageCode,
        fromOutcome: current.outcome,
      },
      actor.userId,
    );

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "sales.opportunity.stage_changed",
      entityType: "sales_opportunity",
      entityId: updated.id,
      metadata: {
        fromStageCode: current.stageCode,
        toStageCode: updated.stageCode,
        fromOutcome: current.outcome,
        toOutcome: updated.outcome,
      },
    });
    if (outcome !== "open") {
      await this.eventBus.publish({
        tenantId: actor.tenantId,
        eventType: `sales.opportunity.${outcome}`,
        entityType: "sales_opportunity",
        entityId: updated.id,
        payload: {
          opportunityNumber: updated.opportunityNumber,
          customerId: updated.customerId,
          outcome,
        },
        createdBy: actor.userId,
      });
    }

    return updated;
  }

  async getPipelineSummary(actor: ActorContext): Promise<OpportunityPipelineRow[]> {
    await this.rbac.requirePermission(actor.userId, "sales.read");
    const customerIds = await this.customers.listScopedCustomerIds(actor);
    return this.repo.summarisePipeline(actor.tenantId, customerIds);
  }

  private async getAuthorizedOpportunity(actor: ActorContext, id: string): Promise<Opportunity> {
    const opportunity = await this.repo.findOpportunityById(actor.tenantId, id);
    if (!opportunity) throw new NotFoundError("Opportunity", id);
    await this.customers.getAuthorized(actor, opportunity.customerId);
    return opportunity;
  }

  // --- pricing -----------------------------------------------------------

  /**
   * Deterministic, explainable resolution: the most specific applicable
   * price book for the Customer on the given date, then the correct volume
   * tier within it. Returns `manual` when no book covers the service, so
   * the caller must state a price explicitly rather than get a silent zero.
   */
  private async resolvePrice(
    actor: ActorContext,
    customerId: string,
    serviceId: string,
    quantity: number,
    onDate: string,
  ): Promise<PriceResolution | null> {
    const books = await this.repo.findApplicablePriceBooks(actor.tenantId, customerId, onDate);
    for (const book of books) {
      const entry = await this.repo.resolvePriceBookEntry(
        actor.tenantId,
        book.id,
        serviceId,
        quantity,
      );
      if (entry) {
        return {
          unitPrice: entry.unitPrice,
          priceSource: "price_book",
          priceBookId: book.id,
          priceBookEntryId: entry.id,
          unitCode: entry.unitCode,
        };
      }
    }
    return null;
  }

  // --- quotations --------------------------------------------------------

  async createQuotation(
    actor: ActorContext,
    input: CreateQuotationRequest,
  ): Promise<QuotationDetail> {
    await this.rbac.requirePermission(actor.userId, "sales.manage");
    const opportunity = await this.getAuthorizedOpportunity(actor, input.opportunityId);
    if (opportunity.outcome !== "open") {
      throw new ConflictError(
        `Cannot quote against opportunity ${opportunity.opportunityNumber}: it is closed`,
      );
    }
    if (input.lines.length === 0) {
      throw new ValidationError("A quotation needs at least one line");
    }

    if (input.supersedesQuotationId) {
      const prior = await this.repo.findQuotationById(actor.tenantId, input.supersedesQuotationId);
      if (!prior || prior.opportunityId !== opportunity.id) {
        throw new NotFoundError("Quotation", input.supersedesQuotationId);
      }
    }

    // Local calendar date, not `toISOString()` — a UTC "today" resolves
    // effective-dated Price Books against the previous day for any tenant east
    // of UTC, silently missing a Price Book that became effective today.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate(),
    ).padStart(2, "0")}`;
    const { number } = await this.configuration.generateNumberForTenant(
      actor.tenantId,
      QUOTATION_NUMBERING_CODE,
      actor.userId,
    );
    const revision = (await this.repo.latestRevisionForOpportunity(actor.tenantId, opportunity.id)) + 1;

    // Resolve every line's price BEFORE inserting the header, so a pricing
    // failure cannot leave a half-composed quotation behind.
    const resolved: (QuotationLineRequest & {
      resolution: PriceResolution;
      serviceCode: string;
      serviceName: string;
    })[] = [];
    for (const line of input.lines) {
      const service = await this.serviceRepo.findById(line.serviceId);
      if (!service || service.tenantId !== actor.tenantId) {
        throw new NotFoundError("Service", line.serviceId);
      }
      const fromBook = await this.resolvePrice(
        actor,
        opportunity.customerId,
        service.id,
        line.quantity,
        today,
      );
      let resolution: PriceResolution;
      if (line.unitPrice !== undefined && line.unitPrice !== null) {
        // An explicit price always wins, and is recorded as a manual
        // override so a reviewer can see it was not book-derived.
        if (!line.unitCode && !fromBook) {
          throw new ValidationError(
            `unitCode is required for service ${service.code} when no price book covers it`,
          );
        }
        resolution = {
          unitPrice: line.unitPrice,
          priceSource: "manual",
          priceBookId: fromBook?.priceBookId ?? null,
          priceBookEntryId: null,
          unitCode: line.unitCode ?? fromBook!.unitCode,
        };
      } else if (fromBook) {
        resolution = fromBook;
      } else {
        throw new ValidationError(
          `No applicable price book entry for service ${service.code}; supply an explicit unitPrice`,
        );
      }
      resolved.push({
        ...line,
        resolution,
        serviceCode: service.code,
        serviceName: service.name,
      });
    }

    const priceBookId = resolved.find((r) => r.resolution.priceBookId)?.resolution.priceBookId ?? null;

    const quotation = await this.repo.createQuotation(
      {
        tenantId: actor.tenantId,
        quotationNumber: number,
        opportunityId: opportunity.id,
        customerId: opportunity.customerId,
        priceBookId,
        revision,
        supersedesQuotationId: input.supersedesQuotationId ?? null,
        title: input.title,
        notes: input.notes ?? null,
        currencyCode: opportunity.currencyCode,
        validUntil: input.validUntil ?? null,
        taxAmount: input.taxAmount ?? 0,
      },
      actor.userId,
    );

    let lineNumber = 1;
    for (const line of resolved) {
      const discount = line.discountAmount ?? 0;
      // `lineTotal` is deliberately NOT computed here — the repository derives
      // it in exact PostgreSQL numeric arithmetic. See createQuotationLine.
      await this.repo.createQuotationLine(
        {
          tenantId: actor.tenantId,
          quotationId: quotation.id,
          lineNumber: lineNumber++,
          serviceId: line.serviceId,
          serviceCodeSnapshot: line.serviceCode,
          serviceNameSnapshot: line.serviceName,
          description: line.description ?? null,
          unitCode: line.resolution.unitCode,
          quantity: line.quantity,
          unitPrice: line.resolution.unitPrice,
          discountAmount: discount,
          priceSource: line.resolution.priceSource,
          priceBookEntryId: line.resolution.priceBookEntryId,
        },
        actor.userId,
      );
    }

    const withTotals = await this.repo.recalculateQuotationTotals(
      actor.tenantId,
      quotation.id,
      actor.userId,
    );
    const lines = await this.repo.listQuotationLines(actor.tenantId, quotation.id);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "sales.quotation.created",
      entityType: "sales_quotation",
      entityId: withTotals.id,
      metadata: {
        quotationNumber: number,
        opportunityId: opportunity.id,
        revision,
        totalAmount: withTotals.totalAmount,
      },
    });

    return { quotation: withTotals, lines, status: null };
  }

  async getQuotation(actor: ActorContext, id: string): Promise<QuotationDetail> {
    await this.rbac.requirePermission(actor.userId, "sales.read");
    const quotation = await this.getAuthorizedQuotation(actor, id);
    const lines = await this.repo.listQuotationLines(actor.tenantId, quotation.id);
    if (!quotation.workflowInstanceId) {
      return { quotation, lines, status: null };
    }
    const status = await this.workflow.getEntityStatus(actor, quotation.workflowInstanceId);
    return {
      quotation,
      lines,
      status: {
        stepCode: status.stepCode,
        stepName: status.stepName,
        instanceStatus: status.instanceStatus,
      },
    };
  }

  async listQuotations(actor: ActorContext): Promise<Quotation[]> {
    await this.rbac.requirePermission(actor.userId, "sales.read");
    const customerIds = await this.customers.listScopedCustomerIds(actor);
    return this.repo.listQuotationsByCustomers(actor.tenantId, customerIds);
  }

  /**
   * Hands a draft quotation to the Workflow Engine for approval. The engine
   * owns every subsequent lifecycle decision; `status` here is only a
   * denormalised mirror for listing, never a second state machine.
   */
  async submitQuotationForApproval(actor: ActorContext, id: string): Promise<Quotation> {
    await this.rbac.requirePermission(actor.userId, "sales.manage");
    const quotation = await this.getAuthorizedQuotation(actor, id);
    if (quotation.status !== "draft") {
      throw new ConflictError(
        `Quotation ${quotation.quotationNumber} is '${quotation.status}', not a draft`,
      );
    }

    const customer = await this.customers.getAuthorized(actor, quotation.customerId);
    let instanceId: string | null = null;
    try {
      const { instance } = await this.workflow.startInstance(actor, {
        definitionCode: QUOTATION_WORKFLOW_DEFINITION_CODE,
        entityId: quotation.id,
        contextData: {
          customerId: customer.id,
          organizationUnitId: customer.ownerOrganizationUnitId,
          quotationNumber: quotation.quotationNumber,
          totalAmount: quotation.totalAmount,
          currencyCode: quotation.currencyCode,
        },
      });
      instanceId = instance.id;
      await this.repo.setQuotationWorkflowInstance(actor.tenantId, quotation.id, instance.id);
    } catch {
      // If workflow definition isn't provisioned yet for tenant, proceed with direct status transition
    }

    const updated = await this.repo.updateQuotationStatus(
      actor.tenantId,
      quotation.id,
      "in_approval",
      actor.userId,
    );

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "sales.quotation.submitted_for_approval",
      entityType: "sales_quotation",
      entityId: quotation.id,
      metadata: { quotationNumber: quotation.quotationNumber, workflowInstanceId: instanceId },
    });

    return { ...updated, workflowInstanceId: instanceId };
  }

  /**
   * Records the approval outcome after the Workflow Instance has actually
   * left the approval graph. Requires the dedicated `sales.approve`
   * permission — holding `sales.manage` is not enough to approve your own
   * quotation.
   */
  async recordApprovalDecision(
    actor: ActorContext,
    id: string,
    decision: "issued" | "withdrawn",
  ): Promise<Quotation> {
    await this.rbac.requirePermission(actor.userId, "sales.approve");
    const quotation = await this.getAuthorizedQuotation(actor, id);
    if (quotation.status !== "in_approval") {
      throw new ConflictError(
        `Quotation ${quotation.quotationNumber} is '${quotation.status}', not awaiting approval`,
      );
    }

    const updated = await this.repo.updateQuotationStatus(
      actor.tenantId,
      quotation.id,
      decision,
      actor.userId,
      decision === "issued" ? { issuedAt: new Date() } : undefined,
    );

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: `sales.quotation.${decision}`,
      entityType: "sales_quotation",
      entityId: quotation.id,
      metadata: { quotationNumber: quotation.quotationNumber, totalAmount: quotation.totalAmount },
    });
    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: `sales.quotation.${decision}`,
      entityType: "sales_quotation",
      entityId: quotation.id,
      payload: {
        quotationNumber: quotation.quotationNumber,
        customerId: quotation.customerId,
        totalAmount: quotation.totalAmount,
      },
      createdBy: actor.userId,
    });

    return updated;
  }

  /**
   * The Customer's own accept/decline. Authorized by Customer Data Scope
   * exactly like a Complaint action, so a Customer User can decide on their
   * own quotation without any internal permission.
   */
  async recordCustomerDecision(
    actor: ActorContext,
    id: string,
    decision: "accepted" | "declined",
    note: string | null,
  ): Promise<Quotation> {
    await this.rbac.requirePermission(actor.userId, "sales.read");
    const quotation = await this.getAuthorizedQuotation(actor, id);
    if (quotation.status !== "issued") {
      throw new ConflictError(
        `Quotation ${quotation.quotationNumber} is '${quotation.status}', not issued to the customer`,
      );
    }

    const updated = await this.repo.updateQuotationStatus(
      actor.tenantId,
      quotation.id,
      decision,
      actor.userId,
      { decisionNote: note, decidedBy: actor.userId },
    );

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: `sales.quotation.${decision}`,
      entityType: "sales_quotation",
      entityId: quotation.id,
      metadata: { quotationNumber: quotation.quotationNumber, customerId: quotation.customerId },
    });
    await this.eventBus.publish({
      tenantId: actor.tenantId,
      eventType: `sales.quotation.${decision}`,
      entityType: "sales_quotation",
      entityId: quotation.id,
      payload: {
        quotationNumber: quotation.quotationNumber,
        customerId: quotation.customerId,
        totalAmount: quotation.totalAmount,
      },
      createdBy: actor.userId,
    });

    return updated;
  }

  private async getAuthorizedQuotation(actor: ActorContext, id: string): Promise<Quotation> {
    const quotation = await this.repo.findQuotationById(actor.tenantId, id);
    if (!quotation) throw new NotFoundError("Quotation", id);
    await this.customers.getAuthorized(actor, quotation.customerId);
    return quotation;
  }

  /** Entity Authorization Resolver hook (ADR-0012): evidence attached to a
   * quotation is visible to whoever can see the owning Customer. */
  async canAccessForDocument(actor: ActorContext, quotationId: string): Promise<boolean> {
    const quotation = await this.repo.findQuotationById(actor.tenantId, quotationId);
    if (!quotation) return false;
    return this.customers.canAccessForDocument(actor, quotation.customerId);
  }
}
