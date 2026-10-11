/**
 * Finance Master (WP-MD-01) — cost centers + payment terms.
 *
 * Master data, not transactions: nothing here posts, moves money, or
 * participates in a workflow. Effective windows (DEC-001) are validated by
 * the service and by the DB CHECK; each tenant/code holds one master row.
 */

export type CostCenterType = "cost" | "profit";
export type CostCenterStatus = "active" | "inactive";

export interface FinanceCostCenter {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  type: CostCenterType;
  /** K1: at most one level of parent-child hierarchy (DB trigger enforces). */
  parentId: string | null;
  legalEntityId: string | null;
  orgUnitId: string | null;
  status: CostCenterStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FinancePaymentTerm {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  netDays: number;
  discountDays: number | null;
  discountPercent: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CreateCostCenterInput {
  tenantId: string;
  code: string;
  name: string;
  type: CostCenterType;
  parentId: string | null;
  legalEntityId: string | null;
  orgUnitId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdBy: string | null;
}

export interface UpdateCostCenterInput {
  name?: string;
  type?: CostCenterType;
  status?: CostCenterStatus;
  effectiveTo?: string | null;
}

export interface CreatePaymentTermInput {
  tenantId: string;
  code: string;
  name: string;
  netDays: number;
  discountDays: number | null;
  discountPercent: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdBy: string | null;
}

export interface UpdatePaymentTermInput {
  name?: string;
  effectiveTo?: string | null;
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

export interface FinanceMasterRepository {
  createCostCenter(input: CreateCostCenterInput): Promise<FinanceCostCenter>;
  findCostCenterById(tenantId: string, id: string): Promise<FinanceCostCenter | null>;
  findCostCenterByCode(tenantId: string, code: string): Promise<FinanceCostCenter | null>;
  listCostCenters(
    tenantId: string,
    filter: { status?: CostCenterStatus; type?: CostCenterType },
  ): Promise<FinanceCostCenter[]>;
  updateCostCenter(
    id: string,
    input: UpdateCostCenterInput,
    updatedBy: string | null,
  ): Promise<FinanceCostCenter | null>;

  createPaymentTerm(input: CreatePaymentTermInput): Promise<FinancePaymentTerm>;
  findPaymentTermById(tenantId: string, id: string): Promise<FinancePaymentTerm | null>;
  findPaymentTermByCode(tenantId: string, code: string): Promise<FinancePaymentTerm | null>;
  listPaymentTerms(tenantId: string): Promise<FinancePaymentTerm[]>;
  updatePaymentTerm(
    id: string,
    input: UpdatePaymentTermInput,
    updatedBy: string | null,
  ): Promise<FinancePaymentTerm | null>;
}
