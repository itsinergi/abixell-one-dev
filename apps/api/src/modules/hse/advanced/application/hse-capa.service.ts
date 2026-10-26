import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../../domain/shared-kernel/errors.js";
import type { AuditService } from "../../../../application/audit/audit.service.js";
import type { RbacService } from "../../../../application/rbac/rbac.service.js";
import type { ConfigurationService } from "../../../../application/configuration/configuration.service.js";
import { closureRate, ratePerHours } from "../domain/hse-advanced.math.js";
import {
  CAPA_ACTION_TYPES,
  CAPA_STATUSES,
  type CapaActionType,
  type CapaStatus,
  type HseAdvancedRepository,
  type HseCapa,
  type HseCapaAction,
  type HseIndicatorSnapshot,
} from "../domain/hse-advanced.entity.js";

import { HSE_CAPA_NUMBERING_CODE } from "./hse-assurance.service.js";

/** Base for the two rate indicators: per 200,000 hours worked. */
const RATE_BASE_HOURS = 200_000;

/**
 * HSE Advanced — CAPA and indicators (HSE-ADV-006/007).
 *
 * The two boundaries that shape this file:
 *
 * - **§1 CAPA is its own aggregate.** A CAPA may carry a *read-only* reference
 *   to a Core follow-up; this file never writes `hse_follow_ups`, and no Core
 *   path may require a CAPA to exist. A follow-up completing does not close a
 *   CAPA, and a CAPA closing does not complete a follow-up — they are two
 *   records of two different promises.
 * - **§7 Indicators are frozen snapshots.** A snapshot records the window it
 *   covers and every figure it used, including the denominators. Nothing here
 *   lets an operator type a rate, and nothing recomputes a stored one.
 */
export class HseCapaService {
  constructor(
    private readonly repo: HseAdvancedRepository,
    private readonly configuration: ConfigurationService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  // =====================================================================
  // HSE-ADV-006 — CAPA
  // =====================================================================

  /**
   * Raise a CAPA against at least one recorded source.
   *
   * A CAPA with no anchor is an intention, not a corrective action: nobody can
   * tell later what it answered. At least one of the five anchors is required,
   * and every anchor supplied is checked to belong to this tenant.
   */
  async createCapa(
    actor: ActorContext,
    input: {
      title: string;
      description?: string | null;
      hseRecordId?: string | null;
      investigationId?: string | null;
      auditFindingId?: string | null;
      monitoringReadingId?: string | null;
      coreFollowUpId?: string | null;
      rootCause?: string | null;
      actionType?: CapaActionType;
      ownerUserId?: string | null;
      dueDate?: string | null;
    },
  ): Promise<HseCapa> {
    await this.rbac.requirePermission(actor, "hse.advanced.manage");

    const anchors = {
      hseRecordId: input.hseRecordId ?? null,
      investigationId: input.investigationId ?? null,
      auditFindingId: input.auditFindingId ?? null,
      monitoringReadingId: input.monitoringReadingId ?? null,
      coreFollowUpId: input.coreFollowUpId ?? null,
    };
    if (Object.values(anchors).every((v) => v === null)) {
      throw new ValidationError(
        "A CAPA must reference what it answers: an HSE record, investigation, audit finding, monitoring reading, or Core follow-up",
      );
    }

    if (anchors.hseRecordId) await this.requireRecord(actor, anchors.hseRecordId);
    if (anchors.investigationId) {
      const investigation = await this.repo.findInvestigationById(anchors.investigationId);
      if (!investigation || investigation.tenantId !== actor.tenantId) {
        throw new NotFoundError("HseInvestigation", anchors.investigationId);
      }
    }
    if (anchors.auditFindingId) {
      const finding = await this.repo.findAuditFindingById(anchors.auditFindingId);
      if (!finding || finding.tenantId !== actor.tenantId) {
        throw new NotFoundError("HseAuditFinding", anchors.auditFindingId);
      }
    }
    if (anchors.monitoringReadingId) {
      const reading = await this.repo.findMonitoringReadingById(anchors.monitoringReadingId);
      if (!reading || reading.tenantId !== actor.tenantId) {
        throw new NotFoundError("HseMonitoringReading", anchors.monitoringReadingId);
      }
    }
    if (anchors.coreFollowUpId) {
      // Read-only by design: proving the follow-up exists is the whole point of
      // the reference, and the Core row is never touched from here (§1).
      const followUp = await this.repo.findCoreFollowUp(actor.tenantId, anchors.coreFollowUpId);
      if (!followUp) throw new NotFoundError("HseFollowUp", anchors.coreFollowUpId);
    }

    const actionType = input.actionType ?? "corrective";
    if (!CAPA_ACTION_TYPES.includes(actionType)) {
      throw new ValidationError(`Unknown action type '${actionType}'`);
    }
    if (input.ownerUserId && !(await this.repo.userExists(actor.tenantId, input.ownerUserId))) {
      throw new NotFoundError("User", input.ownerUserId);
    }
    const dueDate = input.dueDate ? requireDate(input.dueDate, "dueDate") : null;

    const { number: capaNumber } = await this.configuration.generateNumberForTenant(
      actor.tenantId,
      HSE_CAPA_NUMBERING_CODE,
      actor.userId,
    );

    const capa = await this.repo.createCapa({
      tenantId: actor.tenantId,
      capaNumber,
      title: requireText(input.title, "title"),
      description: clean(input.description),
      ...anchors,
      rootCause: clean(input.rootCause),
      actionType,
      ownerUserId: input.ownerUserId ?? null,
      dueDate,
      createdBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "hse.capa.created",
      entityType: "hse_capa",
      entityId: capa.id,
      metadata: { capaNumber, actionType, ...anchors },
    });
    return capa;
  }

  async getCapa(
    actor: ActorContext,
    id: string,
  ): Promise<{ capa: HseCapa; actions: HseCapaAction[] }> {
    await this.rbac.requirePermission(actor, "hse.advanced.read");
    const capa = await this.requireCapa(actor, id);
    return { capa, actions: await this.repo.listCapaActions(capa.id) };
  }

  async listCapas(actor: ActorContext): Promise<HseCapa[]> {
    await this.rbac.requirePermission(actor, "hse.advanced.read");
    return this.repo.listCapas(actor.tenantId, await this.scopeOf(actor));
  }

  async addAction(
    actor: ActorContext,
    capaId: string,
    input: { description: string; ownerUserId?: string | null; dueDate?: string | null },
  ): Promise<HseCapaAction> {
    await this.rbac.requirePermission(actor, "hse.advanced.manage");
    const capa = await this.requireCapa(actor, capaId);
    if (capa.status === "closed" || capa.status === "cancelled") {
      throw new ConflictError(`CAPA ${capa.capaNumber} is ${capa.status}; no further action can be added`);
    }
    if (input.ownerUserId && !(await this.repo.userExists(actor.tenantId, input.ownerUserId))) {
      throw new NotFoundError("User", input.ownerUserId);
    }

    const action = await this.repo.createCapaAction({
      tenantId: actor.tenantId,
      capaId: capa.id,
      description: requireText(input.description, "description"),
      ownerUserId: input.ownerUserId ?? null,
      dueDate: input.dueDate ? requireDate(input.dueDate, "dueDate") : null,
      createdBy: actor.userId,
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "hse.capa_action.created",
      entityType: "hse_capa_action",
      entityId: action.id,
      metadata: { capaNumber: capa.capaNumber },
    });
    return action;
  }

  async completeAction(
    actor: ActorContext,
    capaId: string,
    actionId: string,
    input: { completionNotes?: string | null },
  ): Promise<HseCapaAction> {
    await this.rbac.requirePermission(actor, "hse.advanced.manage");
    const capa = await this.requireCapa(actor, capaId);
    const actions = await this.repo.listCapaActions(capa.id);
    const action = actions.find((a) => a.id === actionId);
    if (!action) throw new NotFoundError("HseCapaAction", actionId);
    if (action.completedAt) {
      throw new ConflictError("That action is already complete");
    }

    const completed = await this.repo.completeCapaAction({
      tenantId: actor.tenantId,
      actionId,
      completedAt: new Date(),
      completionNotes: clean(input.completionNotes),
    });
    if (!completed) throw new NotFoundError("HseCapaAction", actionId);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "hse.capa_action.completed",
      entityType: "hse_capa_action",
      entityId: actionId,
      metadata: { capaNumber: capa.capaNumber },
    });
    return completed;
  }

  /**
   * Move a CAPA through its own status machine.
   *
   * `closed` is reachable only from `verification` and only by someone holding
   * `hse.capa.verify`: a CAPA is closed on evidence that it worked, not on the
   * say-so of whoever performed it. `cancelled` needs a reason, because a
   * cancelled corrective action is a decision that someone will ask about.
   */
  async changeStatus(
    actor: ActorContext,
    capaId: string,
    input: { status: CapaStatus; verificationNotes?: string | null },
  ): Promise<HseCapa> {
    if (!CAPA_STATUSES.includes(input.status)) {
      throw new ValidationError(`Unknown CAPA status '${input.status}'`);
    }
    const capa = await this.requireCapa(actor, capaId);

    if (input.status === "closed") {
      await this.rbac.requirePermission(actor, "hse.capa.verify");
      if (capa.status !== "verification") {
        throw new ConflictError(
          `CAPA ${capa.capaNumber} is ${capa.status}; only a CAPA under verification can be closed`,
        );
      }
      if (!clean(input.verificationNotes)) {
        throw new ValidationError("Closing a CAPA requires verification notes");
      }
    } else {
      await this.rbac.requirePermission(actor, "hse.advanced.manage");
    }

    if (capa.status === "closed" || capa.status === "cancelled") {
      throw new ConflictError(`CAPA ${capa.capaNumber} is ${capa.status} and cannot change status`);
    }
    if (input.status === "cancelled" && !clean(input.verificationNotes)) {
      throw new ValidationError("Cancelling a CAPA requires a reason");
    }

    const now = new Date();
    const updated = await this.repo.updateCapaStatus({
      tenantId: actor.tenantId,
      capaId: capa.id,
      status: input.status,
      verificationNotes: clean(input.verificationNotes),
      verifiedAt: input.status === "closed" ? now : null,
      verifiedBy: input.status === "closed" ? actor.userId : null,
      closedAt: input.status === "closed" ? now : null,
      updatedBy: actor.userId,
    });
    if (!updated) throw new NotFoundError("HseCapa", capaId);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "hse.capa.status_changed",
      entityType: "hse_capa",
      entityId: capa.id,
      metadata: { capaNumber: capa.capaNumber, from: capa.status, to: input.status },
    });
    return updated;
  }

  // =====================================================================
  // HSE-ADV-007 — indicator snapshots
  // =====================================================================

  /**
   * Compute and freeze one window.
   *
   * The counts come from recorded facts; the rates are derived here from those
   * counts and the denominators the caller supplies. `exposureHours` and
   * `lostDays` are supplied rather than read, because no table in this product
   * records attendance hours — inventing a denominator would make every rate a
   * fiction. Absent them the rates are stored as null, which reads as "not
   * measured" instead of "zero".
   */
  async computeSnapshot(
    actor: ActorContext,
    input: {
      windowStart: string;
      windowEnd: string;
      organizationUnitId?: string | null;
      exposureHours?: string | null;
      lostDays?: number | null;
      nearMissCategoryCode?: string | null;
      lostTimeSeverityCode?: string | null;
    },
  ): Promise<HseIndicatorSnapshot> {
    await this.rbac.requirePermission(actor, "hse.indicator.compute");

    const windowStart = requireDate(input.windowStart, "windowStart");
    const windowEnd = requireDate(input.windowEnd, "windowEnd");
    if (windowEnd < windowStart) {
      throw new ValidationError("windowEnd must not be before windowStart");
    }
    if (input.organizationUnitId) {
      await this.rbac.requireOrganizationUnitScopeForActor(actor, input.organizationUnitId);
      if (!(await this.repo.organizationUnitExists(actor.tenantId, input.organizationUnitId))) {
        throw new NotFoundError("OrganizationUnit", input.organizationUnitId);
      }
    }
    const exposureHours = input.exposureHours ? requireDecimal(input.exposureHours, "exposureHours") : null;
    const lostDays = input.lostDays ?? 0;
    if (!Number.isInteger(lostDays) || lostDays < 0) {
      throw new ValidationError("lostDays must be a non-negative whole number");
    }

    const facts = await this.repo.gatherIndicatorFacts({
      tenantId: actor.tenantId,
      windowStart,
      windowEnd,
      organizationUnitId: input.organizationUnitId ?? null,
      orgUnitIds: await this.scopeOf(actor),
      nearMissCategoryCode: clean(input.nearMissCategoryCode),
      lostTimeSeverityCode: clean(input.lostTimeSeverityCode),
    });

    const snapshot = await this.repo.createIndicatorSnapshot({
      tenantId: actor.tenantId,
      organizationUnitId: input.organizationUnitId ?? null,
      windowStart,
      windowEnd,
      exposureHours,
      nearMissCount: facts.nearMissCount,
      observationCount: facts.observationCount,
      inspectionCount: facts.inspectionCount,
      capaOpenedCount: facts.capaOpenedCount,
      capaClosedCount: facts.capaClosedCount,
      capaClosureRate: closureRate(facts.capaClosedCount, facts.capaOpenedCount),
      permitCount: facts.permitCount,
      incidentCount: facts.incidentCount,
      lostTimeIncidentCount: facts.lostTimeIncidentCount,
      lostDays,
      incidentFrequencyRate: ratePerHours(facts.lostTimeIncidentCount, exposureHours, RATE_BASE_HOURS),
      severityRate: ratePerHours(lostDays, exposureHours, RATE_BASE_HOURS),
      computedBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "hse.indicator_snapshot.computed",
      entityType: "hse_indicator_snapshot",
      entityId: snapshot.id,
      metadata: {
        windowStart,
        windowEnd,
        organizationUnitId: snapshot.organizationUnitId,
        exposureHours,
      },
    });
    return snapshot;
  }

  async listSnapshots(actor: ActorContext): Promise<HseIndicatorSnapshot[]> {
    await this.rbac.requirePermission(actor, "hse.advanced.read");
    return this.repo.listIndicatorSnapshots(actor.tenantId, await this.scopeOf(actor));
  }

  // =====================================================================
  // Internals
  // =====================================================================

  private async requireCapa(actor: ActorContext, id: string): Promise<HseCapa> {
    const capa = await this.repo.findCapaById(id);
    if (!capa || capa.tenantId !== actor.tenantId) {
      throw new NotFoundError("HseCapa", id);
    }
    // A CAPA has no organization unit of its own; scope resolves through its
    // anchor. A CAPA anchored only to a follow-up has no unit to check, so it
    // needs tenant-wide scope — never authorized on nothing.
    if (capa.hseRecordId) {
      await this.requireRecord(actor, capa.hseRecordId);
    } else if (capa.investigationId) {
      const investigation = await this.repo.findInvestigationById(capa.investigationId);
      if (investigation?.hseRecordId) await this.requireRecord(actor, investigation.hseRecordId);
    } else if (!(await this.rbac.hasTenantScope(actor))) {
      throw new ForbiddenError(
        "Your Data Scope does not cover this CAPA (it carries no organization unit)",
      );
    }
    return capa;
  }

  private async requireRecord(actor: ActorContext, hseRecordId: string): Promise<void> {
    const record = await this.repo.findCoreRecord(actor.tenantId, hseRecordId);
    if (!record) throw new NotFoundError("HseRecord", hseRecordId);
    if (record.organizationUnitId) {
      await this.rbac.requireOrganizationUnitScopeForActor(actor, record.organizationUnitId);
    } else if (!(await this.rbac.hasTenantScope(actor))) {
      throw new ForbiddenError(
        "Your Data Scope does not cover this HSE record (no organization unit set)",
      );
    }
  }

  private async scopeOf(actor: ActorContext): Promise<string[] | null> {
    const scoped = await this.rbac.listScopedOrganizationUnitIds(actor);
    if (scoped !== null && scoped.length === 0) {
      throw new ForbiddenError("The active Role's Data Scope covers no Organization Unit");
    }
    return scoped;
  }
}

// ---------------------------------------------------------------------------
// Input helpers
// ---------------------------------------------------------------------------

function requireText(value: string | undefined | null, field: string): string {
  const text = (value ?? "").trim();
  if (!text) throw new ValidationError(`${field} is required`);
  return text;
}

function clean(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const text = value.trim();
  return text ? text : null;
}

const DECIMAL = /^\d{1,16}(\.\d{1,4})?$/;

function requireDecimal(value: string, field: string): string {
  const text = String(value ?? "").trim();
  if (!DECIMAL.test(text)) throw new ValidationError(`${field} must be a non-negative decimal`);
  return text;
}

function requireDate(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ValidationError(`${field} must be YYYY-MM-DD`);
  return value;
}
