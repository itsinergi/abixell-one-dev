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
import { isThresholdBreach } from "../domain/hse-advanced.math.js";
import {
  AUDIT_FINDING_TYPES,
  AUDIT_PROGRAMME_TYPES,
  CAPA_ACTION_TYPES,
  type AuditFindingType,
  type AuditProgrammeType,
  type AuditResult,
  type CapaActionType,
  type HseAdvancedRepository,
  type HseAuditFinding,
  type HseAuditOccurrence,
  type HseAuditProgramme,
  type HseMonitoringPoint,
  type HseMonitoringReading,
} from "../domain/hse-advanced.entity.js";

/** Tenant Configuration code for CAPA numbers. */
export const HSE_CAPA_NUMBERING_CODE = "hse_capa";

/**
 * HSE Advanced — assurance (HSE-ADV-004/005/006).
 *
 * Programmes, monitoring and CAPA in one service because they are one story: a
 * programme occurrence raises a finding, a monitoring point raises a breach, and
 * either may raise a CAPA that closes on verified evidence.
 *
 * The boundaries ADR-0027 draws, and what each costs here:
 *
 * - **§5 Programmes are scheduled templates over findings.** The module records
 *   what was found; it never fires the job and never mutates incident or asset
 *   state as a consequence of a finding.
 * - **§6 Monitoring is measurement + threshold.** A breach sets a flag on the
 *   reading and may raise a CAPA. This file keeps no corrective-action list.
 * - **§1 CAPA is a separate aggregate from the Core follow-up.** A CAPA may
 *   carry a read-only reference to a Core follow-up; `hse_follow_ups` is never
 *   written from here, and no Core path requires a CAPA to exist.
 */
export class HseAssuranceService {
  constructor(
    private readonly repo: HseAdvancedRepository,
    private readonly configuration: ConfigurationService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  // =====================================================================
  // HSE-ADV-004 — programmes, occurrences, findings
  // =====================================================================

  async createProgramme(
    actor: ActorContext,
    input: {
      code: string;
      name: string;
      description?: string | null;
      programmeType?: AuditProgrammeType;
      frequencyDays: number;
      checklist?: { code: string; question: string; isMandatory?: boolean }[];
      organizationUnitId?: string | null;
      siteId?: string | null;
      ownerUserId?: string | null;
    },
  ): Promise<HseAuditProgramme> {
    await this.rbac.requirePermission(actor, "hse.advanced.manage");

    const programmeType = input.programmeType ?? "inspection";
    if (!AUDIT_PROGRAMME_TYPES.includes(programmeType)) {
      throw new ValidationError(`Unknown programme type '${programmeType}'`);
    }
    if (!Number.isInteger(input.frequencyDays) || input.frequencyDays <= 0) {
      throw new ValidationError("frequencyDays must be a positive whole number of days");
    }
    if (input.organizationUnitId) {
      await this.rbac.requireOrganizationUnitScopeForActor(actor, input.organizationUnitId);
      if (!(await this.repo.organizationUnitExists(actor.tenantId, input.organizationUnitId))) {
        throw new NotFoundError("OrganizationUnit", input.organizationUnitId);
      }
    }
    if (input.siteId && !(await this.repo.siteExists(actor.tenantId, input.siteId))) {
      throw new NotFoundError("Site", input.siteId);
    }
    if (input.ownerUserId && !(await this.repo.userExists(actor.tenantId, input.ownerUserId))) {
      throw new NotFoundError("User", input.ownerUserId);
    }

    const checklist = (input.checklist ?? []).map((item) => ({
      code: requireText(item.code, "checklist item code"),
      question: requireText(item.question, "checklist item question"),
      isMandatory: item.isMandatory === true,
    }));
    const codes = new Set(checklist.map((i) => i.code));
    if (codes.size !== checklist.length) {
      // A repeated item code makes a result ambiguous: two answers would claim
      // the same anchor and nothing could tell which one was meant.
      throw new ValidationError("Checklist item codes must be unique within a programme");
    }

    const programme = await this.repo.createAuditProgramme({
      tenantId: actor.tenantId,
      code: requireText(input.code, "code"),
      name: requireText(input.name, "name"),
      description: clean(input.description),
      programmeType,
      frequencyDays: input.frequencyDays,
      checklist,
      organizationUnitId: input.organizationUnitId ?? null,
      siteId: input.siteId ?? null,
      ownerUserId: input.ownerUserId ?? null,
      createdBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "hse.audit_programme.created",
      entityType: "hse_audit_programme",
      entityId: programme.id,
      metadata: {
        code: programme.code,
        programmeType: programme.programmeType,
        frequencyDays: programme.frequencyDays,
      },
    });
    return programme;
  }

  async listProgrammes(actor: ActorContext): Promise<HseAuditProgramme[]> {
    await this.rbac.requirePermission(actor, "hse.advanced.read");
    return this.repo.listAuditProgrammes(actor.tenantId, await this.scopeOf(actor));
  }

  /**
   * Record a scheduled occurrence.
   *
   * The Scheduler decides when a job fires; this records the date it was for and
   * refuses a duplicate on it, because two occurrences on one date are one
   * inspection counted twice.
   */
  async scheduleOccurrence(
    actor: ActorContext,
    programmeId: string,
    scheduledFor: string,
  ): Promise<HseAuditOccurrence> {
    await this.rbac.requirePermission(actor, "hse.advanced.manage");
    const programme = await this.requireProgramme(actor, programmeId);
    requireDate(scheduledFor, "scheduledFor");

    const existing = await this.repo.listAuditOccurrences(programme.id);
    if (existing.some((o) => o.scheduledFor === scheduledFor)) {
      throw new ConflictError(
        `Programme '${programme.code}' already has an occurrence scheduled for ${scheduledFor}`,
      );
    }

    const occurrence = await this.repo.createAuditOccurrence({
      tenantId: actor.tenantId,
      programmeId: programme.id,
      scheduledFor,
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "hse.audit_occurrence.scheduled",
      entityType: "hse_audit_occurrence",
      entityId: occurrence.id,
      metadata: { programmeCode: programme.code, scheduledFor },
    });
    return occurrence;
  }

  async listOccurrences(actor: ActorContext, programmeId: string): Promise<HseAuditOccurrence[]> {
    await this.rbac.requirePermission(actor, "hse.advanced.read");
    const programme = await this.requireProgramme(actor, programmeId);
    return this.repo.listAuditOccurrences(programme.id);
  }

  /**
   * Record what the inspection actually found.
   *
   * Every mandatory checklist item must carry a result: an inspection that
   * skipped its mandatory questions did not establish what it claims to
   * establish. Optional items may be omitted.
   */
  async completeOccurrence(
    actor: ActorContext,
    occurrenceId: string,
    input: { results: AuditResult[]; notes?: string | null },
  ): Promise<HseAuditOccurrence> {
    await this.rbac.requirePermission(actor, "hse.advanced.manage");
    const occurrence = await this.repo.findAuditOccurrenceById(occurrenceId);
    if (!occurrence || occurrence.tenantId !== actor.tenantId) {
      throw new NotFoundError("HseAuditOccurrence", occurrenceId);
    }
    const programme = await this.requireProgramme(actor, occurrence.programmeId);

    const results = input.results.map((r) => ({
      itemCode: requireText(r.itemCode, "result itemCode"),
      result: requireText(r.result, "result"),
      note: clean(r.note),
    }));
    const answered = new Set(results.map((r) => r.itemCode));

    for (const result of results) {
      if (!programme.checklist.some((item) => item.code === result.itemCode)) {
        throw new ValidationError(
          `Result names item '${result.itemCode}', which is not on programme '${programme.code}'`,
        );
      }
    }
    const unanswered = programme.checklist
      .filter((item) => item.isMandatory && !answered.has(item.code))
      .map((item) => item.code);
    if (unanswered.length > 0) {
      throw new ValidationError(
        `Mandatory checklist items have no result: ${unanswered.join(", ")}`,
      );
    }

    const completed = await this.repo.completeAuditOccurrence({
      tenantId: actor.tenantId,
      occurrenceId: occurrence.id,
      performedAt: new Date(),
      performedBy: actor.userId,
      results,
      notes: clean(input.notes),
    });
    if (!completed) throw new NotFoundError("HseAuditOccurrence", occurrenceId);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "hse.audit_occurrence.completed",
      entityType: "hse_audit_occurrence",
      entityId: occurrence.id,
      metadata: { programmeCode: programme.code, results: results.length },
    });
    return completed;
  }

  /**
   * Record a finding. A finding is a recorded gap and nothing more: it raises
   * no CAPA by itself and mutates no incident or asset state (ADR-0027 §5). The
   * CAPA is raised deliberately, by whoever owns the response.
   */
  async createFinding(
    actor: ActorContext,
    occurrenceId: string,
    input: {
      findingType?: AuditFindingType;
      checklistItemCode?: string | null;
      description: string;
    },
  ): Promise<HseAuditFinding> {
    await this.rbac.requirePermission(actor, "hse.advanced.manage");
    const occurrence = await this.repo.findAuditOccurrenceById(occurrenceId);
    if (!occurrence || occurrence.tenantId !== actor.tenantId) {
      throw new NotFoundError("HseAuditOccurrence", occurrenceId);
    }
    const programme = await this.requireProgramme(actor, occurrence.programmeId);

    const findingType = input.findingType ?? "nonconformity";
    if (!AUDIT_FINDING_TYPES.includes(findingType)) {
      throw new ValidationError(`Unknown finding type '${findingType}'`);
    }
    const itemCode = clean(input.checklistItemCode);
    if (itemCode && !programme.checklist.some((item) => item.code === itemCode)) {
      throw new ValidationError(
        `Finding names item '${itemCode}', which is not on programme '${programme.code}'`,
      );
    }

    const finding = await this.repo.createAuditFinding({
      tenantId: actor.tenantId,
      occurrenceId: occurrence.id,
      findingType,
      checklistItemCode: itemCode,
      description: requireText(input.description, "description"),
      createdBy: actor.userId,
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "hse.audit_finding.created",
      entityType: "hse_audit_finding",
      entityId: finding.id,
      metadata: { findingType, occurrenceId: occurrence.id },
    });
    return finding;
  }

  async listFindings(actor: ActorContext, occurrenceId: string): Promise<HseAuditFinding[]> {
    await this.rbac.requirePermission(actor, "hse.advanced.read");
    const occurrence = await this.repo.findAuditOccurrenceById(occurrenceId);
    if (!occurrence || occurrence.tenantId !== actor.tenantId) {
      throw new NotFoundError("HseAuditOccurrence", occurrenceId);
    }
    await this.requireProgramme(actor, occurrence.programmeId);
    return this.repo.listAuditFindings(occurrence.id);
  }

  // =====================================================================
  // HSE-ADV-005 — environmental monitoring
  // =====================================================================

  async createMonitoringPoint(
    actor: ActorContext,
    input: {
      code: string;
      name: string;
      parameterCode: string;
      unit: string;
      thresholdMin?: string | null;
      thresholdMax?: string | null;
      organizationUnitId?: string | null;
      siteId?: string | null;
    },
  ): Promise<HseMonitoringPoint> {
    await this.rbac.requirePermission(actor, "hse.advanced.manage");

    const thresholdMin = input.thresholdMin ? requireDecimal(input.thresholdMin, "thresholdMin") : null;
    const thresholdMax = input.thresholdMax ? requireDecimal(input.thresholdMax, "thresholdMax") : null;
    if (thresholdMin !== null && thresholdMax !== null && compareDecimal(thresholdMax, thresholdMin) < 0) {
      throw new ValidationError("thresholdMax must not be below thresholdMin");
    }
    if (thresholdMin === null && thresholdMax === null) {
      throw new ValidationError(
        "A monitoring point needs at least one threshold — nothing was declared to breach",
      );
    }
    if (input.organizationUnitId) {
      await this.rbac.requireOrganizationUnitScopeForActor(actor, input.organizationUnitId);
      if (!(await this.repo.organizationUnitExists(actor.tenantId, input.organizationUnitId))) {
        throw new NotFoundError("OrganizationUnit", input.organizationUnitId);
      }
    }
    if (input.siteId && !(await this.repo.siteExists(actor.tenantId, input.siteId))) {
      throw new NotFoundError("Site", input.siteId);
    }

    const point = await this.repo.createMonitoringPoint({
      tenantId: actor.tenantId,
      code: requireText(input.code, "code"),
      name: requireText(input.name, "name"),
      parameterCode: requireText(input.parameterCode, "parameterCode"),
      unit: requireText(input.unit, "unit"),
      thresholdMin,
      thresholdMax,
      organizationUnitId: input.organizationUnitId ?? null,
      siteId: input.siteId ?? null,
      createdBy: actor.userId,
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "hse.monitoring_point.created",
      entityType: "hse_monitoring_point",
      entityId: point.id,
      metadata: {
        code: point.code,
        parameterCode: point.parameterCode,
        thresholdMin: point.thresholdMin,
        thresholdMax: point.thresholdMax,
      },
    });
    return point;
  }

  async listMonitoringPoints(actor: ActorContext): Promise<HseMonitoringPoint[]> {
    await this.rbac.requirePermission(actor, "hse.advanced.read");
    return this.repo.listMonitoringPoints(actor.tenantId, await this.scopeOf(actor));
  }

  /**
   * Record a reading.
   *
   * The breach flag is written from the thresholds as they stand right now
   * (ADR-0027 §6): a later threshold change must not rewrite a past breach, and
   * recomputing on read would do exactly that. The comparison is exact-decimal,
   * so a reading at the boundary is not tipped over by float error.
   */
  async recordReading(
    actor: ActorContext,
    pointId: string,
    input: { measuredAt: string; value: string; note?: string | null },
  ): Promise<HseMonitoringReading> {
    await this.rbac.requirePermission(actor, "hse.advanced.manage");
    const point = await this.requirePoint(actor, pointId);

    const measuredAt = new Date(requireDateTime(input.measuredAt, "measuredAt"));
    const value = requireDecimal(input.value, "value");
    const isBreach = isThresholdBreach(value, point.thresholdMin, point.thresholdMax);

    const previous = await this.repo.listMonitoringReadings(point.id, 1);
    if (previous.some((r) => r.measuredAt.getTime() === measuredAt.getTime())) {
      // `uq_hse_monitoring_readings` would refuse this anyway; refusing here
      // reports which reading collided rather than surfacing a raw constraint.
      throw new ConflictError("A reading already exists for this point at that moment");
    }

    const reading = await this.repo.createMonitoringReading({
      tenantId: actor.tenantId,
      pointId: point.id,
      measuredAt,
      value,
      isBreach,
      recordedBy: actor.userId,
      note: clean(input.note),
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "hse.monitoring_reading.recorded",
      entityType: "hse_monitoring_reading",
      entityId: reading.id,
      metadata: { pointCode: point.code, isBreach },
    });
    return reading;
  }

  async listReadings(
    actor: ActorContext,
    pointId: string,
    limit = 50,
  ): Promise<HseMonitoringReading[]> {
    await this.rbac.requirePermission(actor, "hse.advanced.read");
    const point = await this.requirePoint(actor, pointId);
    return this.repo.listMonitoringReadings(point.id, Math.min(Math.max(limit, 1), 500));
  }

  private async requireProgramme(actor: ActorContext, id: string): Promise<HseAuditProgramme> {
    const programme = await this.repo.findAuditProgrammeById(id);
    if (!programme || programme.tenantId !== actor.tenantId) {
      throw new NotFoundError("HseAuditProgramme", id);
    }
    if (programme.organizationUnitId) {
      await this.rbac.requireOrganizationUnitScopeForActor(actor, programme.organizationUnitId);
    } else if (!(await this.rbac.hasTenantScope(actor))) {
      throw new ForbiddenError(
        "Your Data Scope does not cover this programme (no organization unit set)",
      );
    }
    return programme;
  }

  private async requirePoint(actor: ActorContext, id: string): Promise<HseMonitoringPoint> {
    const point = await this.repo.findMonitoringPointById(id);
    if (!point || point.tenantId !== actor.tenantId) {
      throw new NotFoundError("HseMonitoringPoint", id);
    }
    if (point.organizationUnitId) {
      await this.rbac.requireOrganizationUnitScopeForActor(actor, point.organizationUnitId);
    } else if (!(await this.rbac.hasTenantScope(actor))) {
      throw new ForbiddenError(
        "Your Data Scope does not cover this monitoring point (no organization unit set)",
      );
    }
    return point;
  }

  private async scopeOf(actor: ActorContext): Promise<string[] | null> {
    const scoped = await this.rbac.listScopedOrganizationUnitIds(actor);
    if (scoped !== null && scoped.length === 0) {
      throw new ForbiddenError("The active Role's Data Scope covers no Organization Unit");
    }
    return scoped;
  }

  /** Kept so the compiler proves the CAPA vocabulary is still the one exported. */
  static readonly capaActionTypes: readonly CapaActionType[] = CAPA_ACTION_TYPES;
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

const DECIMAL = /^-?\d{1,16}(\.\d{1,4})?$/;

/** A non-negative decimal in the column's own shape, kept as text. */
function requireDecimal(value: string, field: string): string {
  const text = String(value ?? "").trim();
  if (!DECIMAL.test(text)) throw new ValidationError(`${field} must be a decimal number`);
  return text;
}

/** Compare two decimals without floating point, returning -1, 0 or 1. */
function compareDecimal(a: string, b: string): number {
  const [aWhole, aFrac = ""] = a.split(".");
  const [bWhole, bFrac = ""] = b.split(".");
  const aScaled = BigInt(aWhole) * 10000n + BigInt((aFrac + "0000").slice(0, 4));
  const bScaled = BigInt(bWhole) * 10000n + BigInt((bFrac + "0000").slice(0, 4));
  if (aScaled < bScaled) return -1;
  if (aScaled > bScaled) return 1;
  return 0;
}

function requireDate(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ValidationError(`${field} must be YYYY-MM-DD`);
  return value;
}

function requireDateTime(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    throw new ValidationError(`${field} must be an ISO date-time`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ValidationError(`${field} is not a valid moment`);
  return value;
}