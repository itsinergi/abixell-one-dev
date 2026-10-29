import type {
  AppParameter,
  ConfigScope,
  ConfigurationRepository,
  EffectiveFeatureFlag,
  EffectiveParameterValue,
  EffectiveTerminology,
  ParameterLevel,
} from "../../domain/configuration/configuration.entity.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import { ConflictError, NotFoundError, ValidationError } from "../../domain/shared-kernel/errors.js";
import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { ModuleConfigLookup } from "../../domain/configuration/module-config-manifest.entity.js";
import { SchemaRegistryValidator } from "./schema-registry-validator.js";
import { formatNumber } from "./numbering-formatter.js";

/** Wave 3 step 11 keys read `menu.<menu code>.description` (seeded by
 * 1787500000000_epic-3-menu-terminology.cjs); everything else is a short
 * label. This picks the bounded schema, it does not authorize the write. */
const DESCRIPTION_TERMINOLOGY_KEY = /^(menu|window|tab|table|field)\..+\.description$/;

export class ConfigurationService {
  private readonly validator: SchemaRegistryValidator;

  constructor(
    private readonly repo: ConfigurationRepository,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly manifests?: ModuleConfigLookup,
  ) {
    this.validator = new SchemaRegistryValidator(repo);
  }

  // --- Module Activation ---------------------------------------------------

  async listModuleActivations(actor: ActorContext) {
    await this.rbac.requirePermission(actor, "config.read");
    return this.repo.listModuleActivations(actor.tenantId);
  }

  async listActiveModuleCodesForTenant(tenantId: string): Promise<string[]> {
    return this.repo.listActiveModuleCodes(tenantId);
  }

  async setModuleActivation(actor: ActorContext, moduleCode: string, isActive: boolean) {
    // Epic 15 Decision #7: granular `config.module.manage` is the preferred code;
    // legacy `config.manage` still works so pre-Epic-15 assignments keep acting.
    await this.rbac.requireAnyPermission(actor, ["config.module.manage", "config.manage"]);
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
    await this.rbac.requirePermission(actor, "config.read");
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
    await this.rbac.requirePermission(actor, "config.read");
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
    await this.rbac.requirePermission(actor, "config.manage");
    await this.validator.validate("feature_flag", "value", isEnabled);

    // Setting an Organization-Unit-scoped override requires the actor's
    // own Data Scope to cover that unit — same rule as 0B's
    // OrganizationUnitService, applied here to Configuration Scope so a
    // Supervisor cannot flip a flag for a Site outside their assignment.
    if (scope.type === "organization_unit") {
      await this.rbac.requireOrganizationUnitScopeForActor(actor, scope.organizationUnitId);
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
    await this.rbac.requirePermission(actor, "config.read");
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
    await this.rbac.requirePermission(actor, "config.manage");
    // Two bounded shapes, chosen by which field the key feeds: a short label
    // (60, `terminology.value`) or a longer description (240,
    // `terminology.description_value`, for description fields on menus,
    // windows, tabs, tables, fields). Which key exists is core data — the
    // Schema Registry refuses the write if this migration was never applied.
    const schemaKey = DESCRIPTION_TERMINOLOGY_KEY.test(code) ? "description_value" : "value";
    await this.validator.validate("terminology", schemaKey, value);
    // §4.2 open item #4: a tenant override needs audit, not a version chain.
    // "sebelum/sesudah" is only real if the previous value is captured here —
    // the override row is overwritten in place and keeps no history of its own.
    const overrides = await this.repo.listTerminologyOverrides(actor.tenantId);
    const previousValue = overrides.find((o) => o.code === code)?.value ?? null;
    await this.repo.upsertTerminologyOverride(actor.tenantId, code, value, actor.userId);
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "config.terminology.changed",
      entityType: "terminology_key",
      entityId: null,
      metadata: { code, previousValue, value },
    });
  }

  // --- Reference Data -----------------------------------------------------------

  async listReferenceDataTypes(actor: ActorContext) {
    await this.rbac.requirePermission(actor, "config.read");
    return this.repo.listReferenceDataTypeCatalog();
  }

  async listReferenceDataItems(actor: ActorContext, typeCode: string) {
    await this.rbac.requirePermission(actor, "config.read");
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
    await this.rbac.requirePermission(actor, "config.manage");
    await this.validator.validate("reference_data", "item", item);

    // Check tenant-add permission at the service layer before repository write
    const refType = await this.repo.getReferenceDataTypeByCode(typeCode);
    if (!refType) throw new NotFoundError("ReferenceDataType", typeCode);
    if (!refType.allowTenantAdd) {
      throw new ValidationError(
        `Reference Data type '${typeCode}' does not allow tenant-added items`,
      );
    }

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

  /**
   * Checkpoint 1C.6 — trusted-caller create (no `config.manage`). A business
   * admin surface that has already authorized the actor for its own operation
   * (e.g. ComplaintConfigurationService, gated on `complaint.configure`)
   * creates a reference-data item through here. Validation + audit are
   * preserved exactly as the permission-gated path — only the RBAC check is
   * the caller's responsibility. */
  async createReferenceDataItemForTrustedCaller(
    tenantId: string,
    actorUserId: string,
    typeCode: string,
    item: { code: string; label: string; sortOrder?: number },
  ) {
    await this.validator.validate("reference_data", "item", item);

    const refType = await this.repo.getReferenceDataTypeByCode(typeCode);
    if (!refType) throw new NotFoundError("ReferenceDataType", typeCode);
    if (!refType.allowTenantAdd) {
      throw new ValidationError(
        `Reference Data type '${typeCode}' does not allow tenant-added items`,
      );
    }

    try {
      const created = await this.repo.createReferenceDataItem(tenantId, typeCode, item, actorUserId);
      await this.audit.record({
        tenantId,
        actorUserId,
        action: "config.reference_data_item.created",
        entityType: "reference_data_item",
        entityId: created.id,
        metadata: { typeCode, code: item.code, label: item.label },
      });
      return created;
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new ConflictError(`Reference Data item '${item.code}' already exists for type '${typeCode}'`);
      }
      throw err;
    }
  }

  /** Checkpoint 1C.6 — generic activate/deactivate of a reference-data item
   * (config.manage). Additive: Configuration Core previously supported only
   * create/read for reference items. Audited. */
  async setReferenceDataItemActive(
    actor: ActorContext,
    typeCode: string,
    itemId: string,
    isActive: boolean,
  ) {
    await this.rbac.requirePermission(actor, "config.manage");
    return this.setReferenceDataItemActiveInternal(actor.tenantId, actor.userId, typeCode, itemId, isActive);
  }

  /** Trusted-caller variant (no config.manage) — see the create counterpart. */
  async setReferenceDataItemActiveForTrustedCaller(
    tenantId: string,
    actorUserId: string,
    typeCode: string,
    itemId: string,
    isActive: boolean,
  ) {
    return this.setReferenceDataItemActiveInternal(tenantId, actorUserId, typeCode, itemId, isActive);
  }

  private async setReferenceDataItemActiveInternal(
    tenantId: string,
    actorUserId: string,
    typeCode: string,
    itemId: string,
    isActive: boolean,
  ) {
    const updated = await this.repo.setReferenceDataItemActive(tenantId, typeCode, itemId, isActive, actorUserId);
    if (!updated) throw new NotFoundError("ReferenceDataItem", itemId);
    await this.audit.record({
      tenantId,
      actorUserId,
      action: isActive ? "config.reference_data_item.activated" : "config.reference_data_item.deactivated",
      entityType: "reference_data_item",
      entityId: updated.id,
      metadata: { typeCode, code: updated.code, isActive },
    });
    return updated;
  }

  /** Checkpoint 1C.6 — trusted-caller numbering read (no `config.read`). */
  async getNumberingSequenceForTrustedCaller(tenantId: string, code: string) {
    return this.repo.getNumberingSequence(tenantId, code);
  }

  // --- Parameters ------------------------------------------------------------

  async listAppParameters(actor: ActorContext): Promise<AppParameter[]> {
    await this.rbac.requirePermission(actor, "config.read");
    const rows = await this.repo.listAppParameters();
    // `inUse` lives in the code-owned manifest, not in a column: whether code
    // reads a parameter is a fact about the code, so it cannot drift from it.
    return rows.map((row) => ({
      ...row,
      inUse: this.manifests?.findParameter(row.code)?.inUse ?? true,
    }));
  }

  async resolveEffectiveParameter(
    actor: ActorContext,
    code: string,
    organizationUnitId?: string,
  ): Promise<EffectiveParameterValue> {
    await this.rbac.requirePermission(actor, "config.read");
    const parameter = await this.repo.getAppParameterByCode(code);
    if (!parameter) throw new NotFoundError("AppParameter", code);

    if (organizationUnitId) {
      await this.rbac.requireOrganizationUnitScopeForActor(actor, organizationUnitId);
    }

    const values = await this.repo.listParameterValues(actor.tenantId, parameter.id);
    const organizationValue = organizationUnitId
      ? values.find(
          (value) =>
            value.level === "O" && value.organizationScopeId === organizationUnitId,
        )
      : undefined;
    const clientValue = values.find(
      (value) => value.level === "C" && value.clientScopeId === actor.tenantId,
    );
    const systemValue = values.find((value) => value.level === "S");

    if (organizationValue) {
      return { code, value: organizationValue.value, sourceLevel: "O" };
    }
    if (clientValue) return { code, value: clientValue.value, sourceLevel: "C" };
    if (systemValue) return { code, value: systemValue.value, sourceLevel: "S" };
    return { code, value: parameter.defaultValue, sourceLevel: "product_default" };
  }

  /** Trusted-caller effective parameter read (same posture as
   * `getNumberingSequenceForTrustedCaller`): a business module needs one
   * configured value without forcing its managers to hold `config.read`.
   * Resolves C → S → product default; null when the parameter does not exist. */
  async getEffectiveParameterValueForTrustedCaller(tenantId: string, code: string): Promise<unknown | null> {
    const parameter = await this.repo.getAppParameterByCode(code);
    if (!parameter) return null;
    const values = await this.repo.listParameterValues(tenantId, parameter.id);
    const clientValue = values.find(
      (value) => value.level === "C" && value.clientScopeId === tenantId,
    );
    const systemValue = values.find((value) => value.level === "S");
    if (clientValue) return clientValue.value;
    if (systemValue) return systemValue.value;
    return parameter.defaultValue;
  }

  async setParameterValue(
    actor: ActorContext,
    code: string,
    input: { level: ParameterLevel; value: unknown; organizationUnitId?: string },
    hasPlatformAuthority: boolean,
  ) {
    await this.rbac.requirePermission(actor, "config.manage");
    const parameter = await this.repo.getAppParameterByCode(code);
    if (!parameter) throw new NotFoundError("AppParameter", code);

    if (!parameter.allowedLevels.includes(input.level)) {
      throw new ValidationError(`Parameter '${code}' does not allow level '${input.level}'`);
    }
    if (input.level === "S" && !hasPlatformAuthority) {
      throw new ValidationError("System parameter writes require platform authority");
    }
    if (input.level === "O") {
      if (!parameter.orgOverrideAllowed || parameter.isGuardrail) {
        throw new ValidationError(`Parameter '${code}' does not allow Organization overrides`);
      }
      if (!input.organizationUnitId) {
        throw new ValidationError("organizationUnitId is required for Organization level");
      }
      await this.rbac.requireOrganizationUnitScopeForActor(actor, input.organizationUnitId);
    }

    await this.validator.validate(parameter.schemaArea, parameter.schemaKey, input.value);
    const previous = (await this.repo.listParameterValues(actor.tenantId, parameter.id)).find(
      (value) =>
        value.level === input.level &&
        value.clientScopeId === (input.level === "S" ? null : actor.tenantId) &&
        value.organizationScopeId === (input.level === "O" ? input.organizationUnitId : null),
    );
    const saved = await this.repo.upsertParameterValue({
      tenantId: actor.tenantId,
      parameterId: parameter.id,
      level: input.level,
      clientScopeId: input.level === "S" ? null : actor.tenantId,
      organizationScopeId: input.level === "O" ? input.organizationUnitId! : null,
      value: input.value,
      updatedBy: actor.userId,
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "config.parameter.changed",
      entityType: "app_parameter",
      entityId: saved.id,
      metadata: { code, level: input.level, previousValue: previous?.value ?? null, value: input.value },
    });
    return saved;
  }

  // --- Numbering -------------------------------------------------------------

  async getOrCreateSequenceInfo(actor: ActorContext, code: string) {
    await this.rbac.requirePermission(actor, "config.read");
    const seq = await this.repo.getNumberingSequence(actor.tenantId, code);
    if (!seq) throw new NotFoundError("NumberingSequence", code);
    return seq;
  }

  async createNumberingSequence(actor: ActorContext, code: string, pattern: string) {
    await this.rbac.requirePermission(actor, "config.manage");
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
    await this.rbac.requirePermission(actor, "config.manage");
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
