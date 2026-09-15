/**
 * Procurement Management — Domain Models Barrel.
 *
 * Re-exports strategic sourcing, RFQ/bidding, vendor governance,
 * supplier contract, service acceptance (SES), and spend analytics
 * domain entities & input models from the legacy monolith entity module
 * to establish the Procurement bounded context boundary.
 */
export * from "./evaluation-policy.js";
export type {
  // Procurement type unions
  ScmProcurementType,
  ScmRfqStatus,
  ScmSupplierBidStatus,
  ScmSupplierEvaluationStatus,
  ScmSupplierRatingGrade,
  ScmSupplierContractType,
  ScmSupplierContractStatus,
  ScmSpendAnalyticsPeriodType,
  ScmServiceAcceptanceStatus,

  // RFQ entities & inputs
  ScmRfq,
  CreateScmRfqInput,
  UpdateScmRfqProjectionInput,
  ScmRfqItem,
  CreateScmRfqItemInput,
  ScmRfqInvitedSupplier,
  CreateScmRfqInvitedSupplierInput,

  // Supplier Bid entities & inputs
  ScmSupplierBid,
  CreateScmSupplierBidInput,
  UpdateScmSupplierBidScoreInput,
  AwardScmSupplierBidInput,
  ScmSupplierBidLine,
  CreateScmSupplierBidLineInput,

  // Supplier Evaluation entities & inputs
  ScmSupplierEvaluation,
  CreateScmSupplierEvaluationInput,
  UpdateScmSupplierEvaluationProjectionInput,

  // Supplier Contract entities & inputs
  ScmSupplierContract,
  CreateScmSupplierContractInput,
  UpdateScmSupplierContractProjectionInput,
  RecordScmSupplierContractSpendInput,
  ScmSupplierContractItem,
  CreateScmSupplierContractItemInput,

  // Spend Analytics entities & inputs
  ScmSpendAnalyticsSnapshot,
  CreateScmSpendAnalyticsSnapshotInput,

  // Service Acceptance entities & inputs
  ScmServiceAcceptance,
  ScmServiceAcceptanceLine,
  CreateScmServiceAcceptanceInput,
  CreateScmServiceAcceptanceLineInput,
  UpdateScmServiceAcceptanceStatusInput,

  // List filter interfaces
  ScmRfqFilter,
  ScmSupplierBidFilter,
  ScmSupplierEvaluationFilter,
  ScmSupplierContractFilter,
  ScmSpendAnalyticsSnapshotFilter,
  ScmServiceAcceptanceFilter,
} from "../../advanced/domain/supply-chain-advanced.entity.js";
