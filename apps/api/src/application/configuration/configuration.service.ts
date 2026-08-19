import type {
  ConfigScope,
  ConfigurationRepository,
  EffectiveFeatureFlag,
  EffectiveTerminology,
} from "../../domain/configuration/configuration.entity.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import { ConflictError, NotFoundError } from "../../domain/shared-kernel/errors.js";
import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import { SchemaRegistryValidator } from "./schema-registry-validator.js";
import { formatNumber } from "./numbering-formatter.js";

export class ConfigurationService {
  private readonly validator: SchemaRegistryValidator;

  constructor(
    private readonly repo: ConfigurationRepository,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {
    this.validator = new SchemaRegistryValidator(repo);
  }

  // --- Module Activation ---------------------------------------------------

  async listModuleActivations(actor: ActorContext) {
    await this.rbac.requirePermission(actor.userId, "config.read");
    return this.repo.listModuleActivations(actor.tenantId);
  }

  async setModuleActivation(actor: ActorContext, moduleCode: string, isActive: boolean) {
    await this.rbac.requirePermission(actor.userId, "config.manage");
    const status = await this.repo.setModuleActivation(
      actor.tenantId,
      moduleCode,
      isActive,
      actor.userId,
    );
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "config.module_activation.changed",
      entityType: "module",
      entityId: status.moduleId,
      metadata: { moduleCode, isActive },
    });
    return status;
  }

  // --- Feature Flags ---------------------------------------------------------

  async listFeatureFlags(actor: ActorContext): Promise<EffectiveFeatureFlag[]> {
    await this.rbac.requirePermission(actor.userId, "config.read");
    const [catalog, assignments] = await Promise.all([
      this.repo.listFeatureFlagCatalog(),
      this.repo.listFeatureFlagAssignments(actor.tenantId),
    ]);
    // Tenant-wide effective value (ignores Organization-Unit-specific
    // overrides — those are resolved separately via
    // resolveEffectiveFeatureFlags, which is where Configuration Scope
    // precedence is actually demonstrated end-to-end).
    return catalog.map((flag) => {
      const tenantAssignment = assignments.find(
        (a) => a.featureFlagCode === flag.code && a.scopeType === "tenant",
      );
      return {
        code: flag.code,
        name: flag.name,
        isEnabled: tenantAssignment ? tenantAssignment.isEnabled : flag.defaultEnabled,
        source: tenantAssignment ? "tenant" : "catalog_default",
      };
    });
  }

  /** Resolves effective Feature Flag values for a specific Organization
   * Unit context, applying Configuration Scope precedence:
   * Organization Unit override > Tenant override > catalog default. */
  async resolveEffectiveFeatureFlags(
    actor: ActorContext,
    organizationUnitId: string,
  ): Promise<EffectiveFeatureFlag[]> {
    await this.rbac.requirePermission(actor.userId, "config.read");
    const [catalog, assignments] = await Promise.all([
      this.repo.listFeatureFlagCatalog(),
      this.repo.listFeatureFlagAssignments(actor.tenantId),
    ]);
    return catalog.map((flag) => {
      const orgUnitAssignment = assignments.find(
        (a) =>
          a.featureFlagCode === flag.code &&
          a.scopeType === "organization_unit" &&
          a.scopeOrganizationUnitId === organizationUnitId,
      );
      if (orgUnitAssignment) {
        return {
          code: flag.code,
          name: flag.name,
          isEnabled: orgUnitAssignment.isEnabled,
          source: "organization_unit" as const,
        };
      }
      const tenantAssignment = assignments.find(
        (a) => a.featureFlagCode === flag.code && a.scopeType === "tenant",
      );
      if (tenantAssignment) {
        return {
          code: flag.code,
          name: flag.name,
          isEnabled: tenantAssignment.isEnabled,
          source: "tenant" as const,
        };
      }
      return {
        code: flag.code,
        name: flag.name,
        isEnabled: flag.defaultEnabled,
        source: "catalog_default" as const,
      };
    });
  }

  async setFeatureFlag(
    actor: ActorContext,
    featureFlagCode: string,
    isEnabled: boolean,
    scope: ConfigScope,
  ) {
    await this.rbac.requirePermission(actor.userId, "config.manage");
    await this.validator.validate("feature_flag", "value", isEnabled);

    // Setting an Organization-Unit-scoped override requires the actor's
    // own Data Scope to cover that unit — same rule as 0B's
    // OrganizationUnitService, applied here to Configuration Scope so a
    // Supervisor cannot flip a flag for a Site outside their assignment.
    if (scope.type === "organization_unit") {
      await this.rbac.requireOrganizationUnitScope(actor.userId, scope.organizationUnitId);
    }

    const assignment = await this.repo.upsertFeatureFlagAssignment(
      actor.tenantId,
      featureFlagCode,
      isEnabled,
      scope,
      actor.userId,
    );
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "config.feature_flag.changed",
      entityType: "feature_flag",
      entityId: assignment.id,
      metadata: { featureFlagCode, isEnabled, scope },
    });
    return assignment;
  }

  // --- Terminology -------------------------------------------------------------

  async listTerminology(actor: ActorContext): Promise<EffectiveTerminology[]> {
    await this.rbac.requirePermission(actor.userId, "config.read");
    const [catalog, overrides] = await Promise.all([
      this.repo.listTerminologyCatalog(),
      this.repo.listTerminologyOverrides(actor.tenantId),
    ]);
    return catalog.map((key) => {
      const override = overrides.find((o) => o.code === key.code);
      return {
        code: key.code,
        defaultLabel: key.defaultLabel,
        value: override ? override.value : key.defaultLabel,
        isOverridden: Boolean(override),
      };
    });
  }

  async setTerminologyOverride(actor: ActorContext, code: string, value: string) {
    await this.rbac.requirePermission(actor.userId, "config.manage");
    await this.validator.validate("terminology", "value", value);
    await this.repo.upsertTerminologyOverride(actor.tenantId, code, value, actor.userId);
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "config.terminology.changed",
      entityType: "terminology_key",
      entityId: null,
      metadata: { code, value },
    });
  }

  // --- Reference Data -----------------------------------------------------------

  async listReferenceDataTypes(actor: ActorContext) {
    await this.rbac.requirePermission(actor.userId, "config.read");
    return this.repo.listReferenceDataTypeCatalog();
  }

  async listReferenceDataItems(actor: ActorContext, typeCode: string) {
    await this.rbac.requirePermission(actor.userId, "config.read");
    return this.repo.listReferenceDataItems(actor.tenantId, typeCode);
  }

  /**
   * Checkpoint 1C.2 — trusted-caller reference-data read (no `config.read`).
   * A business module that has already authorized the actor for its own
   * operation (e.g. `ComplaintService.getCreateOptions`, gated on
   * `complaint.manage`) can read the Tenant's configured catalogs it needs
   * to drive a create form, without granting the broad `config.read`
   * permission to every Customer User. Same trusted-caller posture as
   * `WorkflowService.getInstanceForEntityOwner`. Returns Tenant
   * Configuration verbatim — the values are never hardcoded here.
   */
  async listReferenceDataItemsForTrustedCaller(tenantId: string, typeCode: string) {
    return this.repo.listReferenceDataItems(tenantId, typeCode);
  }

  async createReferenceDataItem(
    actor: ActorContext,
    typeCode: string,
    item: { code: string; label: string; sortOrder?: number },
  ) {
    await this.rbac.requirePermission(actor.userId, "config.manage");
    await this.validator.validate("reference_data", "item", item);

    try {
      const created = await this.repo.createReferenceDataItem(
        actor.tenantId,
        typeCode,
        item,
        actor.userId,
      );
      await this.audit.record({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "config.reference_data_item.created",
        entityType: "reference_data_item",
        entityId: created.id,
        metadata: { typeCode, code: item.code, label: item.label },
      });
      return created;
    } catch (err) {
      // Postgres unique_violation on (tenant_id, reference_data_type_id, code)
      if ((err as { code?: string }).code === "23505") {
        throw new ConflictError(
          `Reference Data item '${item.code}' already exists for type '${typeCode}'`,
        );
      }
      throw err;
    }
  }

  // --- Numbering -------------------------------------------------------------

  async getOrCreateSequenceInfo(actor: ActorContext, code: string) {
    await this.rbac.requirePermission(actor.userId, "config.read");
    const seq = await this.repo.getNumberingSequence(actor.tenantId, code);
    if (!seq) throw new NotFoundError("NumberingSequence", code);
    return seq;
  }

  async createNumberingSequence(actor: ActorContext, code: string, pattern: string) {
    await this.rbac.requirePermission(actor.userId, "config.manage");
    await this.validator.validate("numbering", "pattern", pattern);

    const existing = await this.repo.getNumberingSequence(actor.tenantId, code);
    if (existing) {
      throw new ConflictError(`Numbering sequence '${code}' already exists`);
    }

    const created = await this.repo.createNumberingSequence(
      actor.tenantId,
      code,
      pattern,
      actor.userId,
    );
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "config.numbering_sequence.created",
      entityType: "numbering_sequence",
      entityId: created.id,
      metadata: { code, pattern },
    });
    return created;
  }

  /** Atomically generates the next formatted number for a sequence. */
  async generateNumber(actor: ActorContext, code: string): Promise<{ number: string; sequence: number }> {
    await this.rbac.requirePermission(actor.userId, "config.manage");
    return this.generateNumberForTenant(actor.tenantId, code, actor.userId);
  }

  /**
   * Checkpoint 1B — trusted-caller variant, same posture as
   * `WorkflowService.reopenInstance`/`escalateOverdueAssignmentsForTenant`:
   * a business module's own service (e.g. `ComplaintService.create`) needs
   * to mint a Complaint Number on behalf of ANY authorized submitter,
   * including a Customer User who legitimately creates a Complaint but
   * does not (and should not) hold the broad `config.manage` permission
   * `generateNumber` requires for direct/administrative use. Numbering
   * itself stays exactly as configurable as before (Tenant-authored
   * pattern via `createNumberingSequence`) — only the permission gate on
   * THIS specific call is bypassed, because the caller has already
   * authorized the actor for the business action that needs a number.
   */
  async generateNumberForTenant(
    tenantId: string,
    code: string,
    actorUserId: string | null,
  ): Promise<{ number: string; sequence: number }> {
    const updated = await this.repo.incrementNumberingSequence(tenantId, code);
    const number = formatNumber(updated.pattern, updated.currentSequence, new Date());

    await this.audit.record({
      tenantId,
      actorUserId,
      action: "config.numbering.generated",
      entityType: "numbering_sequence",
      entityId: updated.id,
      metadata: { code, sequence: updated.currentSequence, number },
    });

    return { number, sequence: updated.currentSequence };
  }
}
