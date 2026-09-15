/**
 * Supplier Governance Service (PROC-002).
 *
 * Manages quarterly supplier KPI evaluations using a weighted scorecard
 * (Quality 35%, Delivery 30%, Pricing 20%, Service 15%) and maps the
 * computed total score to standard supplier rating grades (A through E).
 */
import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import type { EntityWorkflowAction, EntityWorkflowStatus } from "../../../../application/workflow/workflow.service.js";
import type {
  CreateScmSupplierEvaluationInput,
  ScmSupplierEvaluation,
  ScmSupplierEvaluationFilter,
} from "../../advanced/domain/supply-chain-advanced.entity.js";
import type { SupplyChainAdvancedService } from "../../advanced/application/supply-chain-advanced.service.js";
import {
  computeSupplierEvaluationScore,
  DEFAULT_EVALUATION_WEIGHTS,
  determineRatingGrade,
  type EvaluationWeights,
  type SupplierCategoryScores,
  type SupplierEvaluationResult,
} from "../domain/evaluation-policy.js";

export interface SupplierEvaluationDetailView {
  evaluation: ScmSupplierEvaluation;
  status: EntityWorkflowStatus | null;
  availableActions: EntityWorkflowAction[];
}

export class SupplierGovernanceService {
  constructor(private readonly delegate: SupplyChainAdvancedService) {}

  /**
   * Computes the weighted score and rating grade from raw category scores
   * using exact scaled-integer arithmetic (no IEEE-754 drift).
   */
  computeScore(
    scores: SupplierCategoryScores,
    weights: EvaluationWeights = DEFAULT_EVALUATION_WEIGHTS,
  ): SupplierEvaluationResult {
    return computeSupplierEvaluationScore(scores, weights);
  }

  /**
   * Maps a total score (0 - 100) to standard supplier rating grade.
   */
  resolveGrade(totalScore: number) {
    return determineRatingGrade(totalScore);
  }

  async createSupplierEvaluation(
    actor: ActorContext,
    input: Omit<CreateScmSupplierEvaluationInput, "createdBy" | "evaluationNumber"> & {
      evaluationNumber?: string;
    },
  ): Promise<SupplierEvaluationDetailView> {
    return this.delegate.createSupplierEvaluation(actor, input);
  }

  async getSupplierEvaluation(
    actor: ActorContext,
    evaluationId: string,
  ): Promise<SupplierEvaluationDetailView> {
    return this.delegate.getSupplierEvaluation(actor, evaluationId);
  }

  async listSupplierEvaluations(
    actor: ActorContext,
    filter: ScmSupplierEvaluationFilter = {},
  ): Promise<Array<{ evaluation: ScmSupplierEvaluation; status: EntityWorkflowStatus | null }>> {
    return this.delegate.listSupplierEvaluations(actor, filter);
  }

  async actOnSupplierEvaluation(
    actor: ActorContext,
    evaluationId: string,
    action: string,
    comment?: string,
  ): Promise<SupplierEvaluationDetailView> {
    return this.delegate.actOnSupplierEvaluation(actor, evaluationId, action, comment);
  }
}
