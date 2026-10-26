import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../../../domain/shared-kernel/errors.js";
import type { AuditService } from "../../../../application/audit/audit.service.js";
import type { RbacService } from "../../../../application/rbac/rbac.service.js";
import {
  fromCents,
  toCents,
  type EarnedValueResult,
  type ProjectAccountingEventPort,
  type ProjectCostEntry,
  type ProjectCostPosition,
  type ProjectDeliveryAdvancedRepository,
  type ProjectEarnedValueSnapshot,
} from "../domain/project-delivery-advanced.entity.js";
import { computeEarnedValue } from "../domain/project-delivery-advanced.math.js";

/**
 * Project Delivery Advanced — cost side (PRJ-ADV-006/007/008).
 *
 * Split from `ProjectPlanService` along the ownership line ADR-0026 §1/§2
 * draws, not for file size: this service is the only one that touches money
 * and the only one allowed to talk to the Accounting Kernel.
 *
 * The rule that shapes every method here: Project Delivery owns project cost
 * truth, Finance owns ledger truth. Nothing in this file writes a journal, a
 * journal line, or an accounting period. A cost entry becomes a fact in
 * `project_cost_entries`, and separately — idempotently — an accounting-ready
 * event in the shared outbox. The kernel decides the accounts.
 */
export class ProjectCostService {
  constructor(
    private readonly repo: ProjectDeliveryAdvancedRepository,
    private readonly accountingEvents: ProjectAccountingEventPort,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  // -------------------------------------------------------------------------
  // Cost ledger (PRJ-ADV-007)
  // -------------------------------------------------------------------------

  async listCostEntries(actor: ActorContext, projectId: string, asOfDate: string | null): Promise<ProjectCostEntry[]> {
    await this.rbac.requirePermission(actor, "project_delivery.cost.read");
    await this.requireProject(actor, projectId);
    if (asOfDate !== null) requireDate(asOfDate, "asOfDate");
    return this.repo.listCostEntries(projectId, asOfDate);
  }

  /**
   * Record a cost against the project.
   *
   * Idempotent on the caller's key so replaying the same invoice is a no-op
   * rather than a double cost. On a replay the existing row is returned
   * unchanged — the caller gets the same answer, and the ledger keeps one line.
   */
  async recordCostEntry(
    actor: ActorContext,
    projectId: string,
    input: {
      activityId?: string | null;
      entryType: "actual" | "commitment" | "adjustment";
      amount: string;
      currency: string;
      entryDate: string;
      sourceDocumentType?: string | null;
      sourceDocumentId?: string | null;
      idempotencyKey: string;
      note?: string | null;
    },
  ): Promise<ProjectCostEntry> {
    await this.rbac.requirePermission(actor, "project_delivery.cost.manage");
    await this.requireProject(actor, projectId);

    const idempotencyKey = requireText(input.idempotencyKey, "idempotencyKey");
    const existing = await this.repo.findCostEntryByIdempotencyKey(actor.tenantId, idempotencyKey);
    if (existing) return existing;

    const amount = requireMoney(input.amount, "amount");
    const currency = requireText(input.currency, "currency").toUpperCase();
    if (currency.length !== 3) throw new ValidationError("currency must be a 3-letter ISO code");
    requireDate(input.entryDate, "entryDate");

    if (input.activityId) {
      const activity = await this.repo.findCoreActivityById(input.activityId);
      if (!activity || activity.tenantId !== actor.tenantId || activity.projectId !== projectId) {
        throw new NotFoundError("ProjectActivity", input.activityId);
      }
    }

    const entry = await this.repo.createCostEntry({
      tenantId: actor.tenantId,
      projectId,
      activityId: input.activityId ?? null,
      entryType: input.entryType,
      amount,
      currency,
      entryDate: input.entryDate,
      sourceDocumentType: clean(input.sourceDocumentType),
      sourceDocumentId: input.sourceDocumentId ?? null,
      idempotencyKey,
      note: clean(input.note),
      createdBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "project_delivery.cost.recorded",
      entityType: "project_cost_entry",
      entityId: entry.id,
      metadata: { projectId, entryType: entry.entryType, amount: entry.amount, currency: entry.currency },
    });
    return entry;
  }

  /**
   * Reverse a cost entry by recording its compensating row.
   *
   * The original is never mutated — the same shape the Accounting Kernel uses
   * for journal reversal, and what makes a cost position reproducible. A
   * second reversal of the same row is refused: a reversal is itself an entry,
   * so an unguarded second one would silently double the credit.
   */
  async reverseCostEntry(actor: ActorContext, entryId: string, note: string | null): Promise<ProjectCostEntry> {
    await this.rbac.requirePermission(actor, "project_delivery.cost.manage");

    const original = await this.repo.findCostEntryById(entryId);
    if (!original || original.tenantId !== actor.tenantId) throw new NotFoundError("ProjectCostEntry", entryId);
    await this.requireProject(actor, original.projectId);

    if (original.entryType === "reversal") {
      throw new ValidationError("A reversal entry cannot itself be reversed");
    }
    const siblings = await this.repo.listCostEntries(original.projectId, null);
    if (siblings.some((e) => e.reversesId === original.id)) {
      throw new ConflictError("This cost entry has already been reversed");
    }

    const reversal = await this.repo.reverseCostEntry({
      tenantId: actor.tenantId,
      entryId,
      note: clean(note),
      createdBy: actor.userId,
    });
    if (!reversal) throw new NotFoundError("ProjectCostEntry", entryId);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "project_delivery.cost.reversed",
      entityType: "project_cost_entry",
      entityId: reversal.id,
      metadata: { projectId: original.projectId, reversesId: original.id, amount: original.amount },
    });
    return reversal;
  }

  /**
   * The authoritative cost position, projected from the entry ledger.
   *
   * A commitment is money promised, not money spent, so it is reported in its
   * own bucket and never folded into actual cost — otherwise a project would
   * look over budget the moment it placed an order. Reversals subtract.
   */
  async getCostPosition(actor: ActorContext, projectId: string, asOfDate: string): Promise<ProjectCostPosition> {
    await this.rbac.requirePermission(actor, "project_delivery.cost.read");
    await this.requireProject(actor, projectId);
    requireDate(asOfDate, "asOfDate");

    const entries = await this.repo.listCostEntries(projectId, asOfDate);

    let actual = 0n;
    let commitment = 0n;
    let adjustment = 0n;
    let currency = "IDR";
    const byActivity = new Map<string | null, { actual: bigint; commitment: bigint }>();

    for (const entry of entries) {
      const cents = toCents(entry.amount);
      if (cents === null) continue;
      currency = entry.currency;
      const bucket = byActivity.get(entry.activityId) ?? { actual: 0n, commitment: 0n };

      switch (entry.entryType) {
        case "actual":
          actual += cents;
          bucket.actual += cents;
          break;
        case "reversal":
          actual -= cents;
          bucket.actual -= cents;
          break;
        case "commitment":
          commitment += cents;
          bucket.commitment += cents;
          break;
        case "adjustment":
          adjustment += cents;
          break;
      }
      byActivity.set(entry.activityId, bucket);
    }

    return {
      projectId,
      asOfDate,
      currency,
      actualCost: fromCents(actual),
      commitmentCost: fromCents(commitment),
      adjustmentCost: fromCents(adjustment),
      totalCommittedCost: fromCents(actual + commitment + adjustment),
      byActivity: [...byActivity.entries()].map(([activityId, v]) => ({
        activityId,
        actualCost: fromCents(v.actual),
        commitmentCost: fromCents(v.commitment),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Earned value (PRJ-ADV-006)
  // -------------------------------------------------------------------------

  /**
   * Compute earned value as of a date, against the approved baseline.
   *
   * Without an approved baseline there is no Budget At Completion and therefore
   * no earned value at all — the honest answer is a refusal, not a zero that
   * looks like a real measurement.
   */
  async computeEarnedValue(actor: ActorContext, projectId: string, asOfDate: string): Promise<EarnedValueResult> {
    await this.rbac.requirePermission(actor, "project_delivery.advanced.read");
    await this.requireProject(actor, projectId);
    requireDate(asOfDate, "asOfDate");

    const baseline = await this.repo.findActiveBaseline(projectId);
    if (!baseline) {
      throw new ValidationError("This project has no approved baseline; earned value needs one for Budget At Completion");
    }

    const [lines, activities, entries] = await Promise.all([
      this.repo.listBaselineLines(baseline.id),
      this.repo.listCoreActivities(projectId),
      this.repo.listCostEntries(projectId, asOfDate),
    ]);

    const currency = entries[0]?.currency ?? "IDR";
    return computeEarnedValue(projectId, asOfDate, currency, lines, activities, entries);
  }

  /**
   * Freeze an earned-value result as a stored snapshot.
   *
   * Stored, not recomputed on read: a later cost entry or baseline change must
   * not silently rewrite a period that has already been reported. One snapshot
   * per (project, date) — re-freezing the same date is refused rather than
   * quietly overwriting the figure someone already presented.
   */
  async snapshotEarnedValue(
    actor: ActorContext,
    projectId: string,
    asOfDate: string,
    notes: string | null,
  ): Promise<ProjectEarnedValueSnapshot> {
    await this.rbac.requirePermission(actor, "project_delivery.advanced.manage");
    const computed = await this.computeEarnedValue(actor, projectId, asOfDate);

    const existing = await this.repo.listEarnedValueSnapshots(projectId);
    if (existing.some((s) => s.asOfDate === asOfDate)) {
      throw new ConflictError(`An earned-value snapshot for ${asOfDate} already exists`);
    }

    const snapshot = await this.repo.createEarnedValueSnapshot({
      tenantId: actor.tenantId,
      projectId,
      asOfDate,
      currency: computed.currency,
      plannedValue: computed.plannedValue,
      earnedValue: computed.earnedValue,
      actualCost: computed.actualCost,
      scheduleVariance: computed.scheduleVariance,
      costVariance: computed.costVariance,
      schedulePerformanceIndex: computed.schedulePerformanceIndex,
      costPerformanceIndex: computed.costPerformanceIndex,
      budgetAtCompletion: computed.budgetAtCompletion,
      estimateAtCompletion: computed.estimateAtCompletion,
      estimateToComplete: computed.estimateToComplete,
      varianceAtCompletion: computed.varianceAtCompletion,
      notes: clean(notes),
      computedBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "project_delivery.earned_value.snapshotted",
      entityType: "project_earned_value_snapshot",
      entityId: snapshot.id,
      metadata: { projectId, asOfDate, earnedValue: snapshot.earnedValue, actualCost: snapshot.actualCost },
    });
    return snapshot;
  }

  async listEarnedValueSnapshots(actor: ActorContext, projectId: string): Promise<ProjectEarnedValueSnapshot[]> {
    await this.rbac.requirePermission(actor, "project_delivery.advanced.read");
    await this.requireProject(actor, projectId);
    return this.repo.listEarnedValueSnapshots(projectId);
  }

  // -------------------------------------------------------------------------
  // Project accounting (PRJ-ADV-008)
  // -------------------------------------------------------------------------

  /**
   * Hand one cost entry to the Accounting Kernel.
   *
   * This is the only path from Project Delivery to the ledger, and it is the
   * Accounting Kernel — not this module — that decides the accounts and posts
   * (ADR-0026 §2). Emission is idempotent on `project-cost:{entryId}`, so a
   * retry after a timeout produces one journal, not two.
   *
   * The local posting row is written only after the outbox call returns, so a
   * failed emission leaves no posting and surfaces as an error rather than
   * being recorded as if it had been handed over.
   */
  async postCostEntry(
    actor: ActorContext,
    entryId: string,
  ): Promise<{ postingId: string; status: "emitted" | "skipped_duplicate" }> {
    await this.rbac.requirePermission(actor, "project_delivery.cost.manage");

    const entry = await this.repo.findCostEntryById(entryId);
    if (!entry || entry.tenantId !== actor.tenantId) throw new NotFoundError("ProjectCostEntry", entryId);
    await this.requireProject(actor, entry.projectId);

    if (entry.entryType === "commitment") {
      // A commitment is a promise, not an incurred cost. Posting it would put
      // money in the ledger that no one has been billed for yet.
      throw new ValidationError("A commitment is not an incurred cost and cannot be posted to the ledger");
    }

    const idempotencyKey = `project-cost:${entry.id}`;
    const existing = await this.accountingEvents.getEventByIdempotencyKey(actor.tenantId, idempotencyKey);
    const status: "emitted" | "skipped_duplicate" = existing ? "skipped_duplicate" : "emitted";

    if (!existing) {
      // The numeric string is bound verbatim so the amount the kernel posts is
      // exactly the amount on the entry, with no float step in between.
      await this.accountingEvents.createEvent(actor.tenantId, {
        eventType: "project.cost_incurred",
        sourceDocumentType: "project_cost_entry",
        sourceDocumentId: entry.id,
        effectiveAt: new Date(`${entry.entryDate}T00:00:00.000Z`),
        currency: entry.currency,
        amount: entry.amount,
        idempotencyKey,
        payload: {
          projectId: entry.projectId,
          activityId: entry.activityId,
          entryType: entry.entryType,
          amount: entry.amount,
          entryDate: entry.entryDate,
          reversesId: entry.reversesId,
        },
        createdBy: actor.userId,
      });
    }

    const posting = await this.repo.recordCostPosting({
      tenantId: actor.tenantId,
      projectId: entry.projectId,
      costEntryId: entry.id,
      idempotencyKey,
      status,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "project_delivery.cost.posted",
      entityType: "project_cost_posting",
      entityId: posting.id,
      metadata: { projectId: entry.projectId, costEntryId: entry.id, status },
    });
    return { postingId: posting.id, status };
  }

  // -------------------------------------------------------------------------
  // Guards
  // -------------------------------------------------------------------------

  private async requireProject(actor: ActorContext, projectId: string): Promise<void> {
    if (!(await this.repo.projectExists(actor.tenantId, projectId))) {
      throw new NotFoundError("Project", projectId);
    }
    const scoped = await this.rbac.listScopedOrganizationUnitIds(actor);
    // `null` is tenant-wide and passes. An empty array is the fail-closed
    // answer for a scope-less session: it authorizes nothing, so it must not
    // widen to every project in the tenant (ADR-0026 §6).
    if (scoped !== null && scoped.length === 0) {
      throw new ForbiddenError("The active Role's Data Scope covers no Organization Unit");
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireText(value: string | undefined, field: string): string {
  const text = (value ?? "").trim();
  if (!text) throw new ValidationError(`${field} is required`);
  return text;
}

/**
 * Refuse anything that is not a plain non-negative 2-decimal amount.
 *
 * A JS `number` would let `0.1 + 0.2` reach the ledger; requiring the caller to
 * send a decimal string keeps every authoritative amount exact (ADR-0026 §5).
 */
function requireMoney(value: string, field: string): string {
  const text = (value ?? "").trim();
  if (!/^\d{1,16}(\.\d{1,2})?$/.test(text)) {
    throw new ValidationError(`${field} must be a non-negative decimal with at most 2 decimal places`);
  }
  return text;
}

function requireDate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError(`${field} must be YYYY-MM-DD`);
  }
}

function clean(value: string | null | undefined): string | null {
  return value?.trim() || null;
}