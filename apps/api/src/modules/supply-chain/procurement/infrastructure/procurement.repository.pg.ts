import type { Pool } from "pg";
import type {
  AwardScmSupplierBidInput,
  CreateScmRfqInput,
  CreateScmServiceAcceptanceInput,
  CreateScmSpendAnalyticsSnapshotInput,
  CreateScmSupplierBidInput,
  CreateScmSupplierContractInput,
  CreateScmSupplierEvaluationInput,
  ScmRfq,
  ScmRfqFilter,
  ScmRfqInvitedSupplier,
  ScmRfqItem,
  ScmServiceAcceptance,
  ScmServiceAcceptanceFilter,
  ScmServiceAcceptanceLine,
  ScmSpendAnalyticsPeriodType,
  ScmSpendAnalyticsSnapshot,
  ScmSpendAnalyticsSnapshotFilter,
  ScmSupplierBid,
  ScmSupplierBidFilter,
  ScmSupplierBidLine,
  ScmSupplierContract,
  ScmSupplierContractFilter,
  ScmSupplierContractItem,
  ScmSupplierEvaluation,
  ScmSupplierEvaluationFilter,
  UpdateScmRfqProjectionInput,
  UpdateScmServiceAcceptanceStatusInput,
  UpdateScmSupplierBidScoreInput,
  UpdateScmSupplierContractProjectionInput,
  UpdateScmSupplierEvaluationProjectionInput,
  RecordScmSupplierContractSpendInput,
} from "../../advanced/domain/supply-chain-advanced.entity.js";
import { PgSupplyChainAdvancedRepository } from "../../advanced/infrastructure/supply-chain-advanced.repository.pg.js";
import type { IUnitOfWork } from "../../ports/unit-of-work.js";
import { PgUnitOfWork } from "../../ports/unit-of-work.js";

/**
 * Procurement Repository interface specifying all database access for the
 * Procurement Management bounded context (12 physical tables).
 */
export interface ProcurementRepository {
  // 1. RFQ
  createRfq(tenantId: string, input: CreateScmRfqInput): Promise<{ rfq: ScmRfq; items: ScmRfqItem[]; invitedSuppliers: ScmRfqInvitedSupplier[] }>;
  updateRfqProjection(tenantId: string, input: UpdateScmRfqProjectionInput): Promise<ScmRfq | null>;
  deleteRfqWithoutWorkflow(tenantId: string, rfqId: string): Promise<void>;
  findRfqById(tenantId: string, rfqId: string): Promise<{ rfq: ScmRfq; items: ScmRfqItem[]; invitedSuppliers: ScmRfqInvitedSupplier[] } | null>;
  listRfqs(tenantId: string, filter?: ScmRfqFilter): Promise<ScmRfq[]>;

  // 2. Supplier Bid
  createSupplierBid(tenantId: string, input: CreateScmSupplierBidInput): Promise<{ bid: ScmSupplierBid; lines: ScmSupplierBidLine[] }>;
  updateSupplierBidScore(tenantId: string, input: UpdateScmSupplierBidScoreInput): Promise<ScmSupplierBid | null>;
  awardSupplierBid(tenantId: string, input: AwardScmSupplierBidInput): Promise<ScmSupplierBid | null>;
  findSupplierBidById(tenantId: string, bidId: string): Promise<{ bid: ScmSupplierBid; lines: ScmSupplierBidLine[] } | null>;
  listSupplierBids(tenantId: string, filter?: ScmSupplierBidFilter): Promise<ScmSupplierBid[]>;

  // 3. Supplier Evaluation
  createSupplierEvaluation(tenantId: string, input: CreateScmSupplierEvaluationInput): Promise<ScmSupplierEvaluation>;
  updateSupplierEvaluationProjection(tenantId: string, input: UpdateScmSupplierEvaluationProjectionInput): Promise<ScmSupplierEvaluation | null>;
  deleteSupplierEvaluationWithoutWorkflow(tenantId: string, evaluationId: string): Promise<void>;
  findSupplierEvaluationById(tenantId: string, evaluationId: string): Promise<ScmSupplierEvaluation | null>;
  listSupplierEvaluations(tenantId: string, filter?: ScmSupplierEvaluationFilter): Promise<ScmSupplierEvaluation[]>;

  // 4. Supplier Contract
  createSupplierContract(tenantId: string, input: CreateScmSupplierContractInput): Promise<{ contract: ScmSupplierContract; items: ScmSupplierContractItem[] }>;
  updateSupplierContractProjection(tenantId: string, input: UpdateScmSupplierContractProjectionInput): Promise<ScmSupplierContract | null>;
  deleteSupplierContractWithoutWorkflow(tenantId: string, contractId: string): Promise<void>;
  recordSupplierContractSpend(tenantId: string, input: RecordScmSupplierContractSpendInput): Promise<ScmSupplierContract | null>;
  findSupplierContractById(tenantId: string, contractId: string): Promise<{ contract: ScmSupplierContract; items: ScmSupplierContractItem[] } | null>;
  listSupplierContracts(tenantId: string, filter?: ScmSupplierContractFilter): Promise<ScmSupplierContract[]>;

  // 5. Spend Analytics
  createSpendAnalyticsSnapshot(tenantId: string, input: CreateScmSpendAnalyticsSnapshotInput): Promise<ScmSpendAnalyticsSnapshot>;
  listSpendAnalyticsSnapshots(tenantId: string, filter?: ScmSpendAnalyticsSnapshotFilter): Promise<ScmSpendAnalyticsSnapshot[]>;
  findSpendAnalyticsSnapshotById(tenantId: string, snapshotId: string): Promise<ScmSpendAnalyticsSnapshot | null>;
  computeSpendAnalyticsSnapshot(tenantId: string, input: { periodType: ScmSpendAnalyticsPeriodType; periodStart: string; periodEnd: string; organizationUnitId?: string | null; createdBy?: string | null }): Promise<ScmSpendAnalyticsSnapshot>;

  // 6. Service Acceptance
  createServiceAcceptance(tenantId: string, input: CreateScmServiceAcceptanceInput): Promise<{ serviceAcceptance: ScmServiceAcceptance; lines: ScmServiceAcceptanceLine[] }>;
  deleteServiceAcceptanceWithoutWorkflow(tenantId: string, serviceAcceptanceId: string): Promise<void>;
  updateServiceAcceptanceStatus(tenantId: string, input: UpdateScmServiceAcceptanceStatusInput): Promise<ScmServiceAcceptance | null>;
  freezeServiceAcceptanceLineAssignment(tenantId: string, lineId: string, frozenAt: Date, accountingReadyEventId?: string | null): Promise<ScmServiceAcceptanceLine | null>;
  findServiceAcceptanceById(tenantId: string, serviceAcceptanceId: string): Promise<{ serviceAcceptance: ScmServiceAcceptance; lines: ScmServiceAcceptanceLine[] } | null>;
  findServiceAcceptanceByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<{ serviceAcceptance: ScmServiceAcceptance; lines: ScmServiceAcceptanceLine[] } | null>;
  listServiceAcceptances(tenantId: string, filter?: ScmServiceAcceptanceFilter): Promise<ScmServiceAcceptance[]>;
}

export class PgProcurementRepository implements ProcurementRepository {
  private readonly delegate: PgSupplyChainAdvancedRepository;
  readonly unitOfWork: IUnitOfWork;

  constructor(pool: Pool) {
    this.delegate = new PgSupplyChainAdvancedRepository(pool);
    this.unitOfWork = new PgUnitOfWork(pool);
  }

  createRfq(tenantId: string, input: CreateScmRfqInput) {
    return this.delegate.createRfq(tenantId, input);
  }
  updateRfqProjection(tenantId: string, input: UpdateScmRfqProjectionInput) {
    return this.delegate.updateRfqProjection(tenantId, input);
  }
  deleteRfqWithoutWorkflow(tenantId: string, rfqId: string) {
    return this.delegate.deleteRfqWithoutWorkflow(tenantId, rfqId);
  }
  findRfqById(tenantId: string, rfqId: string) {
    return this.delegate.findRfqById(tenantId, rfqId);
  }
  listRfqs(tenantId: string, filter?: ScmRfqFilter) {
    return this.delegate.listRfqs(tenantId, filter);
  }

  createSupplierBid(tenantId: string, input: CreateScmSupplierBidInput) {
    return this.delegate.createSupplierBid(tenantId, input);
  }
  updateSupplierBidScore(tenantId: string, input: UpdateScmSupplierBidScoreInput) {
    return this.delegate.updateSupplierBidScore(tenantId, input);
  }
  awardSupplierBid(tenantId: string, input: AwardScmSupplierBidInput) {
    return this.delegate.awardSupplierBid(tenantId, input);
  }
  findSupplierBidById(tenantId: string, bidId: string) {
    return this.delegate.findSupplierBidById(tenantId, bidId);
  }
  listSupplierBids(tenantId: string, filter?: ScmSupplierBidFilter) {
    return this.delegate.listSupplierBids(tenantId, filter);
  }

  createSupplierEvaluation(tenantId: string, input: CreateScmSupplierEvaluationInput) {
    return this.delegate.createSupplierEvaluation(tenantId, input);
  }
  updateSupplierEvaluationProjection(tenantId: string, input: UpdateScmSupplierEvaluationProjectionInput) {
    return this.delegate.updateSupplierEvaluationProjection(tenantId, input);
  }
  deleteSupplierEvaluationWithoutWorkflow(tenantId: string, evaluationId: string) {
    return this.delegate.deleteSupplierEvaluationWithoutWorkflow(tenantId, evaluationId);
  }
  findSupplierEvaluationById(tenantId: string, evaluationId: string) {
    return this.delegate.findSupplierEvaluationById(tenantId, evaluationId);
  }
  listSupplierEvaluations(tenantId: string, filter?: ScmSupplierEvaluationFilter) {
    return this.delegate.listSupplierEvaluations(tenantId, filter);
  }

  createSupplierContract(tenantId: string, input: CreateScmSupplierContractInput) {
    return this.delegate.createSupplierContract(tenantId, input);
  }
  updateSupplierContractProjection(tenantId: string, input: UpdateScmSupplierContractProjectionInput) {
    return this.delegate.updateSupplierContractProjection(tenantId, input);
  }
  deleteSupplierContractWithoutWorkflow(tenantId: string, contractId: string) {
    return this.delegate.deleteSupplierContractWithoutWorkflow(tenantId, contractId);
  }
  recordSupplierContractSpend(tenantId: string, input: RecordScmSupplierContractSpendInput) {
    return this.delegate.recordSupplierContractSpend(tenantId, input);
  }
  findSupplierContractById(tenantId: string, contractId: string) {
    return this.delegate.findSupplierContractById(tenantId, contractId);
  }
  listSupplierContracts(tenantId: string, filter?: ScmSupplierContractFilter) {
    return this.delegate.listSupplierContracts(tenantId, filter);
  }

  createSpendAnalyticsSnapshot(tenantId: string, input: CreateScmSpendAnalyticsSnapshotInput) {
    return this.delegate.createSpendAnalyticsSnapshot(tenantId, input);
  }
  listSpendAnalyticsSnapshots(tenantId: string, filter?: ScmSpendAnalyticsSnapshotFilter) {
    return this.delegate.listSpendAnalyticsSnapshots(tenantId, filter);
  }
  findSpendAnalyticsSnapshotById(tenantId: string, snapshotId: string) {
    return this.delegate.findSpendAnalyticsSnapshotById(tenantId, snapshotId);
  }
  computeSpendAnalyticsSnapshot(
    tenantId: string,
    input: { periodType: ScmSpendAnalyticsPeriodType; periodStart: string; periodEnd: string; organizationUnitId?: string | null; createdBy?: string | null },
  ) {
    return this.delegate.computeSpendAnalyticsSnapshot(tenantId, input);
  }

  createServiceAcceptance(tenantId: string, input: CreateScmServiceAcceptanceInput) {
    return this.delegate.createServiceAcceptance(tenantId, input);
  }
  deleteServiceAcceptanceWithoutWorkflow(tenantId: string, serviceAcceptanceId: string) {
    return this.delegate.deleteServiceAcceptanceWithoutWorkflow(tenantId, serviceAcceptanceId);
  }
  updateServiceAcceptanceStatus(tenantId: string, input: UpdateScmServiceAcceptanceStatusInput) {
    return this.delegate.updateServiceAcceptanceStatus(tenantId, input);
  }
  freezeServiceAcceptanceLineAssignment(tenantId: string, lineId: string, frozenAt: Date, accountingReadyEventId?: string | null) {
    return this.delegate.freezeServiceAcceptanceLineAssignment(tenantId, lineId, frozenAt, accountingReadyEventId);
  }
  findServiceAcceptanceById(tenantId: string, serviceAcceptanceId: string) {
    return this.delegate.findServiceAcceptanceById(tenantId, serviceAcceptanceId);
  }
  findServiceAcceptanceByIdempotencyKey(tenantId: string, idempotencyKey: string) {
    return this.delegate.findServiceAcceptanceByIdempotencyKey(tenantId, idempotencyKey);
  }
  listServiceAcceptances(tenantId: string, filter?: ScmServiceAcceptanceFilter) {
    return this.delegate.listServiceAcceptances(tenantId, filter);
  }
}
