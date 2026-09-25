/**
 * Application Dictionary repository contract.
 * Manages app_windows, app_tabs, app_processes, app_tables, app_fields,
 * app_api_resources, and app_field_rules_versions (versioned structured rules).
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
} from "./app-metadata.entity.js";

export interface AppMetadataRepository {
  // --- Windows (Pages/Routes) -----------------------------------------------

  /** List all windows for a tenant. */
  listWindowsByTenant(tenantId: string): Promise<AppWindow[]>;

  /** Get a single window. */
  getWindow(tenantId: string, windowId: string): Promise<AppWindow | null>;

  /** Get a window by code. */
  getWindowByCode(tenantId: string, code: string): Promise<AppWindow | null>;

  /** Create a new window. */
  createWindow(tenantId: string, window: Omit<AppWindow, "id" | "tenantId" | "createdAt" | "updatedAt">): Promise<AppWindow>;

  /** Update a window. */
  updateWindow(tenantId: string, windowId: string, updates: Partial<Omit<AppWindow, "id" | "tenantId" | "createdAt">>): Promise<AppWindow | null>;

  // --- Tabs (Sections within a Window) ------------------------------------

  /** List tabs for a window. */
  listTabsByWindow(tenantId: string, windowId: string): Promise<AppTab[]>;

  /** Get a single tab. */
  getTab(tenantId: string, tabId: string): Promise<AppTab | null>;

  /** Create a tab. */
  createTab(tenantId: string, tab: Omit<AppTab, "id" | "tenantId" | "createdAt" | "updatedAt">): Promise<AppTab>;

  /** Update a tab. */
  updateTab(tenantId: string, tabId: string, updates: Partial<Omit<AppTab, "id" | "tenantId" | "windowId" | "createdAt">>): Promise<AppTab | null>;

  // --- Processes (Actions/Buttons) ----------------------------------------

  /** List all processes for a tenant. */
  listProcessesByTenant(tenantId: string): Promise<AppProcess[]>;

  /** Get a single process. */
  getProcess(tenantId: string, processId: string): Promise<AppProcess | null>;

  /** Get a process by code. */
  getProcessByCode(tenantId: string, code: string): Promise<AppProcess | null>;

  /** Create a process. */
  createProcess(tenantId: string, process: Omit<AppProcess, "id" | "tenantId" | "createdAt" | "updatedAt">): Promise<AppProcess>;

  /** Update a process. */
  updateProcess(tenantId: string, processId: string, updates: Partial<Omit<AppProcess, "id" | "tenantId" | "createdAt">>): Promise<AppProcess | null>;

  // --- Tables (Data Entities) ----------------------------------------------

  /** List all tables for a tenant. */
  listTablesByTenant(tenantId: string): Promise<AppTable[]>;

  /** Get a single table. */
  getTable(tenantId: string, tableId: string): Promise<AppTable | null>;

  /** Get a table by code. */
  getTableByCode(tenantId: string, code: string): Promise<AppTable | null>;

  /** Create a table. */
  createTable(tenantId: string, table: Omit<AppTable, "id" | "tenantId" | "createdAt" | "updatedAt">): Promise<AppTable>;

  /** Update a table. */
  updateTable(tenantId: string, tableId: string, updates: Partial<Omit<AppTable, "id" | "tenantId" | "createdAt">>): Promise<AppTable | null>;

  // --- Fields (Columns) ---------------------------------------------------

  /** List fields for a table. */
  listFieldsByTable(tenantId: string, tableId: string): Promise<AppField[]>;

  /** Get a single field. */
  getField(tenantId: string, fieldId: string): Promise<AppField | null>;

  /** Get a field by code within a table. */
  getFieldByCode(tenantId: string, tableId: string, code: string): Promise<AppField | null>;

  /** Create a field. */
  createField(tenantId: string, field: Omit<AppField, "id" | "tenantId" | "createdAt" | "updatedAt">): Promise<AppField>;

  /** Update a field. */
  updateField(tenantId: string, fieldId: string, updates: Partial<Omit<AppField, "id" | "tenantId" | "tableId" | "createdAt">>): Promise<AppField | null>;

  // --- API Resources (HTTP Endpoints) ------------------------------------

  /** List all API resources for a tenant. */
  listApiResourcesByTenant(tenantId: string): Promise<AppApiResource[]>;

  /** Get a single API resource. */
  getApiResource(tenantId: string, resourceId: string): Promise<AppApiResource | null>;

  /** Get an API resource by code. */
  getApiResourceByCode(tenantId: string, code: string): Promise<AppApiResource | null>;

  /** Create an API resource. */
  createApiResource(tenantId: string, resource: Omit<AppApiResource, "id" | "tenantId" | "createdAt" | "updatedAt">): Promise<AppApiResource>;

  /** Update an API resource. */
  updateApiResource(tenantId: string, resourceId: string, updates: Partial<Omit<AppApiResource, "id" | "tenantId" | "createdAt">>): Promise<AppApiResource | null>;

  // --- Field Rules (Versioned Structured Rules) --------------------------

  /** Get the current version for a table. */
  getCurrentRuleVersion(tenantId: string, tableId: string): Promise<AppFieldRuleVersion | null>;

  /** Get a specific rule version. */
  getRuleVersion(tenantId: string, versionId: string): Promise<AppFieldRuleVersion | null>;

  /** List all versions for a table. */
  listRuleVersionsByTable(tenantId: string, tableId: string): Promise<AppFieldRuleVersion[]>;

  /** Create a draft rule version. */
  createRuleVersion(tenantId: string, tableId: string, versionNumber: number, rulesDefinition: AppFieldRuleVersion["rulesDefinition"]): Promise<AppFieldRuleVersion>;

  /** Publish a draft version (mark as published and set is_current). */
  publishRuleVersion(tenantId: string, versionId: string, publishedBy: string): Promise<AppFieldRuleVersion>;

  /** Retire a version. */
  retireRuleVersion(tenantId: string, versionId: string): Promise<AppFieldRuleVersion>;

  /** Get rules linked to a field. */
  getRulesByField(tenantId: string, fieldId: string): Promise<AppFieldRule[]>;

  /** Create or link a field rule to a version. */
  createFieldRule(tenantId: string, fieldRule: Omit<AppFieldRule, "id" | "tenantId" | "createdAt" | "updatedAt">): Promise<AppFieldRule>;

  /** Delete a field rule. */
  deleteFieldRule(tenantId: string, ruleId: string): Promise<boolean>;
}
