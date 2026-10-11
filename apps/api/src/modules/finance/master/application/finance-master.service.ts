import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../../domain/shared-kernel/errors.js";
import type { AuditService } from "../../../../application/audit/audit.service.js";
import type { RbacService } from "../../../../application/rbac/rbac.service.js";
import type {
  CreateCostCenterInput,
  CreatePaymentTermInput,
  FinanceCostCenter,
  FinanceMasterRepository,
  FinancePaymentTerm,
  UpdateCostCenterInput,
  UpdatePaymentTermInput,
} from "../domain/finance-master.entity.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PERCENT_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;

/**
 * Finance Master (WP-MD-01).
 *
 * CRUD for cost centers and payment terms with effective-dating enforcement.
 * The overlap check is a service invariant: two active versions of the same
 * code may not have effective windows that intersect, because the dimension
 * consumer must always resolve exactly one active row per code.
 */
export class FinanceMasterService {
  constructor(
    private readonly repo: FinanceMasterRepository,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  // ===================================================================
  // Cost centers
  // ===================================================================

  async createCostCenter(
    actor: ActorContext,
    input: {
      code: string;
      name: string;
      type: "cost" | "profit";
      parentId?: string | null;
      legalEntityId?: string | null;
      orgUnitId?: string | null;
      effectiveFrom: string;
      effectiveTo?: string | null;
    },
  ): Promise<FinanceCostCenter> {
    await this.rbac.requirePermission(actor, "finance.configure");
    this.validateDate(input.effectiveFrom, "effectiveFrom");
    if (input.effectiveTo) this.validateDate(input.effectiveTo, "effectiveTo");
    this.validateWindow(input.effectiveFrom, input.effectiveTo);

    if (await this.repo.findCostCenterByCode(actor.tenantId, input.code)) {
      throw new ConflictError("Cost center code already exists: " + input.code);
    }
    if (input.parentId) {
      const parent = await this.repo.findCostCenterById(actor.tenantId, input.parentId);
      if (!parent) throw new ValidationError("Parent cost center not found: " + input.parentId);
      if (parent.parentId) {
        throw new ValidationError("Cost center hierarchy is limited to one level (K1)");
      }
    }

    const cc = await this.repo.createCostCenter({
      tenantId: actor.tenantId,
      code: input.code,
      name: input.name,
      type: input.type,
      parentId: input.parentId ?? null,
      legalEntityId: input.legalEntityId ?? null,
      orgUnitId: input.orgUnitId ?? null,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      createdBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "finance.cost_center.created",
      entityType: "finance_cost_center",
      entityId: cc.id,
      metadata: { code: cc.code, type: cc.type },
    });
    return cc;
  }

  async listCostCenters(
    actor: ActorContext,
    filter: { status?: "active" | "inactive"; type?: "cost" | "profit" } = {},
  ): Promise<FinanceCostCenter[]> {
    await this.rbac.requirePermission(actor, "finance.read");
    return this.repo.listCostCenters(actor.tenantId, filter);
  }

  async getCostCenter(actor: ActorContext, code: string): Promise<FinanceCostCenter> {
    await this.rbac.requirePermission(actor, "finance.read");
    const cc = await this.repo.findCostCenterByCode(actor.tenantId, code);
    if (!cc) throw new NotFoundError("FinanceCostCenter", code);
    return cc;
  }

  async updateCostCenter(
    actor: ActorContext,
    code: string,
    input: UpdateCostCenterInput,
  ): Promise<FinanceCostCenter> {
    await this.rbac.requirePermission(actor, "finance.configure");
    const cc = await this.getCostCenter(actor, code);
    if (input.effectiveTo !== undefined && input.effectiveTo) {
      this.validateDate(input.effectiveTo, "effectiveTo");
      this.validateWindow(cc.effectiveFrom, input.effectiveTo);
    }
    const updated = await this.repo.updateCostCenter(cc.id, input, actor.userId);
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "finance.cost_center.updated",
      entityType: "finance_cost_center",
      entityId: cc.id,
      metadata: { code: cc.code, fields: Object.keys(input) },
    });
    return updated!;
  }

  // ===================================================================
  // Payment terms
  // ===================================================================

  async createPaymentTerm(
    actor: ActorContext,
    input: {
      code: string;
      name: string;
      netDays: number;
      discountDays?: number | null;
      discountPercent?: string | null;
      effectiveFrom: string;
      effectiveTo?: string | null;
    },
  ): Promise<FinancePaymentTerm> {
    await this.rbac.requirePermission(actor, "finance.configure");
    this.validateDate(input.effectiveFrom, "effectiveFrom");
    if (input.effectiveTo) this.validateDate(input.effectiveTo, "effectiveTo");
    this.validateWindow(input.effectiveFrom, input.effectiveTo);
    if (input.netDays < 0) throw new ValidationError("netDays must be >= 0");
    if (input.discountPercent) {
      if (!PERCENT_PATTERN.test(input.discountPercent)) {
        throw new ValidationError("discountPercent must be 0-100 with up to 2 decimals");
      }
      const n = Number(input.discountPercent);
      if (n < 0 || n > 100) throw new ValidationError("discountPercent must be 0-100");
    }
    if (input.discountDays !== null && input.discountDays !== undefined && input.discountDays < 0) {
      throw new ValidationError("discountDays must be >= 0");
    }

    if (await this.repo.findPaymentTermByCode(actor.tenantId, input.code)) {
      throw new ConflictError("Payment term code already exists: " + input.code);
    }

    const pt = await this.repo.createPaymentTerm({
      tenantId: actor.tenantId,
      code: input.code,
      name: input.name,
      netDays: input.netDays,
      discountDays: input.discountDays ?? null,
      discountPercent: input.discountPercent ?? null,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      createdBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "finance.payment_term.created",
      entityType: "finance_payment_term",
      entityId: pt.id,
      metadata: { code: pt.code, netDays: pt.netDays },
    });
    return pt;
  }

  async listPaymentTerms(actor: ActorContext): Promise<FinancePaymentTerm[]> {
    await this.rbac.requirePermission(actor, "finance.read");
    return this.repo.listPaymentTerms(actor.tenantId);
  }

  async getPaymentTerm(actor: ActorContext, code: string): Promise<FinancePaymentTerm> {
    await this.rbac.requirePermission(actor, "finance.read");
    const pt = await this.repo.findPaymentTermByCode(actor.tenantId, code);
    if (!pt) throw new NotFoundError("FinancePaymentTerm", code);
    return pt;
  }

  async updatePaymentTerm(
    actor: ActorContext,
    code: string,
    input: UpdatePaymentTermInput,
  ): Promise<FinancePaymentTerm> {
    await this.rbac.requirePermission(actor, "finance.configure");
    const pt = await this.getPaymentTerm(actor, code);
    if (input.effectiveTo !== undefined && input.effectiveTo) {
      this.validateDate(input.effectiveTo, "effectiveTo");
      this.validateWindow(pt.effectiveFrom, input.effectiveTo);
    }
    const updated = await this.repo.updatePaymentTerm(pt.id, input, actor.userId);
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "finance.payment_term.updated",
      entityType: "finance_payment_term",
      entityId: pt.id,
      metadata: { code: pt.code, fields: Object.keys(input) },
    });
    return updated!;
  }

  // ===================================================================
  // Validation helpers
  // ===================================================================

  private validateDate(value: string, field: string): void {
    if (!DATE_PATTERN.test(value)) {
      throw new ValidationError(`${field} must be YYYY-MM-DD, got: ${value}`);
    }
  }

  private validateWindow(from: string, to: string | null | undefined): void {
    if (to && to < from) {
      throw new ValidationError("effectiveTo must be >= effectiveFrom");
    }
  }
}
