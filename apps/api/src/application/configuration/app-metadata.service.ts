/**
 * Application Dictionary service (kamus aplikasi).
 *
 * Orchestrates app_windows, app_tabs, app_processes, app_tables, app_fields,
 * app_api_resources, and app_field_rules_versions (versioned structured rules).
 *
 * Locked decisions (CORE-ROADMAP.md §4.2):
 * - Access definitions (Page/API Resource/Table/Field access) come from CODE ONLY.
 *   Super admin may not edit access definitions from the UI.
 * - All objects are tenant-scoped.
 * - Aturan terstruktur (structured rules) only — no text DSL, no expressions.
 */

import type {
  AppWindow,
  AppTab,
  AppProcess,
  AppTable,
  AppField,
  AppApiResource,
  AppFieldRule,
  AppFieldRuleVersion,
  MenuNode,
} from "../../domain/configuration/app-metadata.entity.js";
import type { AppMetadataRepository } from "../../domain/configuration/app-metadata.repository.js";
import { filterMenuForCaller, type MenuFilterInput } from "../../domain/configuration/menu-filter.js";
export type { MenuFilterInput };
import type { MetadataRegistryEntry } from "../../domain/configuration/configuration.entity.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import { NotFoundError, ConflictError, ValidationError } from "../../domain/shared-kernel/errors.js";
import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import { SchemaRegistryValidator } from "./schema-registry-validator.js";

/** Only the slice of ConfigurationRepository the Schema Registry needs. */
export interface MetadataSchemaSource {
  getMetadataSchema(area: string, key: string): Promise<MetadataRegistryEntry | null>;
}

export class AppMetadataService {
  private readonly validator: SchemaRegistryValidator;

  constructor(
    private readonly repo: AppMetadataRepository,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    schemaSource: MetadataSchemaSource,
  ) {
    // SchemaRegistryValidator only calls getMetadataSchema; pass the
    // narrower MetadataSchemaSource shape (satisfied by PgConfigurationRepository).
    this.validator = new SchemaRegistryValidator(schemaSource as ConstructorParameters<typeof SchemaRegistryValidator>[0]);
  }

  // --- Menu tree (§4.3) ------------------------------------------------------

  /**
   * The caller's navigation tree: the tenant catalogue, filtered for THIS
   * caller (§4.3 step 7).
   *
   * Deliberately not permission-gated as a whole. The shell has to render
   * navigation for whoever is signed in, including an external Customer User
   * who holds almost nothing; gating the endpoint on a permission would leave
   * exactly those callers with no navigation at all. What keeps internal
   * structure from reaching them is the filter, not a gate — the whitelist
   * step removes a menu entirely rather than sending it disabled, so a
   * browser that must not know about a page never learns it exists.
   *
   * `caller` is the ACTOR's own effective context, and the route is its only
   * supplier. The rule itself is pure and lives in `menu-filter.ts`; nothing
   * here reads the database beyond the catalogue, so the filter cannot
   * disagree with the permissions `/me` reports alongside it.
   */
  async listMenuTree(actor: ActorContext, caller: MenuFilterInput): Promise<MenuNode[]> {
    const tree = await this.repo.listMenuTree(actor.tenantId);
    return filterMenuForCaller(tree, caller);
  }

  // --- Windows (Pages/Routes) -----------------------------------------------

  async listWindows(actor: ActorContext): Promise<AppWindow[]> {
    await this.rbac.requirePermission(actor, "config.app_dictionary.read");
    return this.repo.listWindowsByTenant(actor.tenantId);
  }

  async getWindow(actor: ActorContext, windowId: string): Promise<AppWindow> {
    await this.rbac.requirePermission(actor, "config.app_dictionary.read");
    const window = await this.repo.getWindow(actor.tenantId, windowId);
    if (!window) throw new NotFoundError("AppWindow", windowId);
    return window;
  }

  async createWindow(
    actor: ActorContext,
    window: Omit<
      AppWindow,
      | "id"
      | "tenantId"
      | "createdAt"
      | "updatedAt"
      // Code-owned route metadata is never part of the input: the seed
      // migration registers routes, not this endpoint (§4.2 "inti di kode").
      | "registrationStatus"
      | "requiredPermissions"
      | "parentPath"
    >,
  ): Promise<AppWindow> {
    await this.rbac.requirePermission(actor, "config.app_dictionary.manage");

    // Check uniqueness by code
    const existing = await this.repo.getWindowByCode(actor.tenantId, window.code);
    if (existing) throw new ConflictError(`Window code '${window.code}' already exists`);

    // LOCKED DECISION: route registration is code-owned (§4.2 "inti di kode").
    // The repository writes `belum_terdaftar` / empty permissions as literals,
    // so there is nothing to pass here; the seed migration is what registers
    // routes.
    const created = await this.repo.createWindow(actor.tenantId, window);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "config.app_window.created",
      entityType: "app_window",
      entityId: created.id,
      metadata: { code: window.code, name: window.name, moduleCode: window.moduleCode },
    });

    return created;
  }

  async updateWindow(
    actor: ActorContext,
    windowId: string,
    updates: Partial<Omit<AppWindow, "id" | "tenantId" | "createdAt">>,
  ): Promise<AppWindow> {
    await this.rbac.requirePermission(actor, "config.app_dictionary.manage");

    // LOCKED DECISION: Super admin cannot edit access-controlling fields
    if ("isExternalAllowed" in updates) {
      throw new ValidationError("Window isExternalAllowed is set in code only; UI edits forbidden");
    }

    // LOCKED DECISION: registration status, required permissions and parent
    // route all decide whether a page renders and who may reach it. They come
    // from ROUTE_REGISTRY (§4.2 "inti di kode"); letting the UI rewrite them
    // would let an operator widen access without a code review.
    for (const field of ["registrationStatus", "requiredPermissions", "parentPath"] as const) {
      if (field in updates) {
        throw new ValidationError(`Window ${field} is set in code only; UI edits forbidden`);
      }
    }

    const updated = await this.repo.updateWindow(actor.tenantId, windowId, updates);
    if (!updated) throw new NotFoundError("AppWindow", windowId);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "config.app_window.updated",
      entityType: "app_window",
      entityId: updated.id,
      metadata: { windowId, updates },
    });

    return updated;
  }

  // --- Tabs (Sections within a Window) ------------------------------------

  async listTabsByWindow(actor: ActorContext, windowId: string): Promise<AppTab[]> {
    await this.rbac.requirePermission(actor, "config.app_dictionary.read");
    // Verify window exists
    await this.getWindow(actor, windowId);
    return this.repo.listTabsByWindow(actor.tenantId, windowId);
  }

  async createTab(
    actor: ActorContext,
    tab: Omit<AppTab, "id" | "tenantId" | "createdAt" | "updatedAt">,
  ): Promise<AppTab> {
    await this.rbac.requirePermission(actor, "config.app_dictionary.manage");

    // Verify window exists
    await this.getWindow(actor, tab.windowId);

    // Validate tab_type
    if (!["fields", "cards", "wizard"].includes(tab.tabType)) {
      throw new ValidationError(`Invalid tab_type: ${tab.tabType}`);
    }

    const created = await this.repo.createTab(actor.tenantId, tab);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "config.app_tab.created",
      entityType: "app_tab",
      entityId: created.id,
      metadata: { windowId: tab.windowId, code: tab.code, name: tab.name, tabType: tab.tabType },
    });

    return created;
  }

  // --- Tables (Data Entities) & Fields (Columns) -------------------------

  async listTables(actor: ActorContext): Promise<AppTable[]> {
    await this.rbac.requirePermission(actor, "config.app_dictionary.read");
    return this.repo.listTablesByTenant(actor.tenantId);
  }

  async getTable(actor: ActorContext, tableId: string): Promise<AppTable> {
    await this.rbac.requirePermission(actor, "config.app_dictionary.read");
    const table = await this.repo.getTable(actor.tenantId, tableId);
    if (!table) throw new NotFoundError("AppTable", tableId);
    return table;
  }

  async listFieldsByTable(actor: ActorContext, tableId: string): Promise<AppField[]> {
    await this.rbac.requirePermission(actor, "config.app_dictionary.read");
    // Verify table exists
    await this.getTable(actor, tableId);
    return this.repo.listFieldsByTable(actor.tenantId, tableId);
  }

  // --- API Resources (HTTP Endpoints) ------------------------------------

  async listApiResources(actor: ActorContext): Promise<AppApiResource[]> {
    await this.rbac.requirePermission(actor, "config.app_dictionary.read");
    return this.repo.listApiResourcesByTenant(actor.tenantId);
  }

  // --- Field Rules (Versioned Structured Rules) --------------------------

  async getCurrentRuleVersion(actor: ActorContext, tableId: string): Promise<AppFieldRuleVersion | null> {
    await this.rbac.requirePermission(actor, "config.app_dictionary.read");
    // Verify table exists
    await this.getTable(actor, tableId);
    return this.repo.getCurrentRuleVersion(actor.tenantId, tableId);
  }

  async listRuleVersionsByTable(actor: ActorContext, tableId: string): Promise<AppFieldRuleVersion[]> {
    await this.rbac.requirePermission(actor, "config.app_dictionary.read");
    // Verify table exists
    await this.getTable(actor, tableId);
    return this.repo.listRuleVersionsByTable(actor.tenantId, tableId);
  }

  async createRuleVersion(
    actor: ActorContext,
    tableId: string,
    rulesDefinition: AppFieldRuleVersion["rulesDefinition"],
  ): Promise<AppFieldRuleVersion> {
    await this.rbac.requirePermission(actor, "config.app_dictionary.manage");

    // Verify table exists
    await this.getTable(actor, tableId);

    // Validate rules against schema
    await this.validator.validate("app_field_rules", "rules_definition", rulesDefinition);

    // Get next version number
    const existing = await this.repo.listRuleVersionsByTable(actor.tenantId, tableId);
    const nextVersion = (existing.length > 0 ? Math.max(...existing.map((v) => v.versionNumber)) : 0) + 1;

    const created = await this.repo.createRuleVersion(
      actor.tenantId,
      tableId,
      nextVersion,
      rulesDefinition,
    );

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "config.app_field_rule_version.created",
      entityType: "app_field_rule_version",
      entityId: created.id,
      metadata: { tableId, versionNumber: nextVersion, status: "draft" },
    });

    return created;
  }

  async publishRuleVersion(actor: ActorContext, versionId: string): Promise<AppFieldRuleVersion> {
    await this.rbac.requirePermission(actor, "config.app_dictionary.manage");

    const version = await this.repo.getRuleVersion(actor.tenantId, versionId);
    if (!version) throw new NotFoundError("AppFieldRuleVersion", versionId);

    if (version.status !== "draft") {
      throw new ValidationError(`Cannot publish a ${version.status} version`);
    }

    const published = await this.repo.publishRuleVersion(actor.tenantId, versionId, actor.userId);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "config.app_field_rule_version.published",
      entityType: "app_field_rule_version",
      entityId: published.id,
      metadata: { tableId: version.tableId, versionNumber: version.versionNumber },
    });

    return published;
  }
}
