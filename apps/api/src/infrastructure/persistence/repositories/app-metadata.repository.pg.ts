import type { Pool } from "pg";
import type {
  AppApiResource,
  AppField,
  AppFieldRule,
  AppFieldRuleVersion,
  AppProcess,
  AppTab,
  AppTable,
  AppWindow,
  MenuNode,
} from "../../../domain/configuration/app-metadata.entity.js";
import type { AppMetadataRepository } from "../../../domain/configuration/app-metadata.repository.js";

/** Row shape of `app_windows`, so a renamed column fails the build. */
interface AppWindowRow {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  description: string | null;
  module_code: string;
  registration_status: "di_menu" | "tersembunyi" | "belum_terdaftar";
  required_permissions: string[];
  parent_path: string | null;
  is_external_allowed: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

function mapWindow(r: AppWindowRow): AppWindow {
  // registration_status and required_permissions are NOT NULL with defaults, so
  // they need no fallback; parent_path is the only nullable one. A fallback on
  // the NOT NULL pair would turn "the column is missing" into a silent
  // belum_terdaftar for the whole dictionary instead of an error.
  return {
    id: r.id,
    tenantId: r.tenant_id,
    code: r.code,
    name: r.name,
    description: r.description ?? undefined,
    moduleCode: r.module_code,
    registrationStatus: r.registration_status,
    requiredPermissions: r.required_permissions,
    parentPath: r.parent_path ?? undefined,
    isExternalAllowed: r.is_external_allowed,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Row shape of one menu node in the tree, parent resolved to its code. */
interface MenuTreeRow {
  code: string;
  name: string;
  description: string | null;
  is_summary: boolean;
  module_code: string | null;
  window_code: string | null;
  is_external_allowed: boolean;
  required_permissions: string[];
  seq_no: number;
  parent_code: string | null;
}

/**
 * One row per menu node, carrying its own parent's code so the tree assembles
 * without a second round trip. Ordered by `seq_no` then `code`, so every
 * sibling list is already in display order by the time it is built.
 *
 * Wave 3 step 11: `name` and `description` fall back to the Product Core
 * catalogue row and yield to a tenant override when one exists
 * (CORE-ROADMAP.md §4.3 "Label dan deskripsi boleh ditimpa tenant, dibatasi
 * daftar istilah yang diizinkan"). The override is reached through
 * `menu_terminology_allowlist`, so a terminology key that the core allowlist
 * does not point at this menu/field pair can never surface here — the gate is
 * the join, not a check downstream.
 *
 * Everything else in the row — `code`, destination, `module_id`,
 * `required_permissions`, `is_external_allowed` — is read from `app_menus`
 * and is deliberately NOT overridable: §4.2 "Tenant hanya menimpa yang
 * aman: label, terminologi, urutan field, field disembunyikan", and
 * guardrail #1 forbids the UI from touching access definitions at all.
 *
 * Both joins are 1:1 by unique constraint (`menu_terminology_allowlist` on
 * (menu_code, field), `tenant_terminology_overrides` on
 * (tenant_id, terminology_key_id)), so a node cannot be multiplied. The
 * override is matched on `t.tenant_id` — the same tenant as the tree row —
 * so one tenant's label never reaches another's tree.
 */
const MENU_TREE_QUERY = `
  SELECT m.code,
         COALESCE(nto.value, m.name) AS name,
         COALESCE(dto.value, m.description) AS description,
         m.is_summary,
         mod.code AS module_code,
         w.code AS window_code,
         m.is_external_allowed,
         m.required_permissions,
         t.seq_no,
         parent.code AS parent_code
    FROM app_menu_tree t
    JOIN app_menus m ON m.id = t.menu_id AND m.tenant_id = t.tenant_id
    LEFT JOIN modules mod ON mod.id = m.module_id
    LEFT JOIN app_windows w ON w.id = m.window_id
    LEFT JOIN app_menus parent ON parent.id = t.parent_id
    LEFT JOIN menu_terminology_allowlist na
           ON na.menu_code = m.code AND na.field = 'name'
    LEFT JOIN tenant_terminology_overrides nto
           ON nto.terminology_key_id = na.terminology_key_id
          AND nto.tenant_id = t.tenant_id
    LEFT JOIN menu_terminology_allowlist da
           ON da.menu_code = m.code AND da.field = 'description'
    LEFT JOIN tenant_terminology_overrides dto
           ON dto.terminology_key_id = da.terminology_key_id
          AND dto.tenant_id = t.tenant_id
   WHERE t.tenant_id = $1
   ORDER BY t.seq_no, m.code`;

function mapMenuRow(r: MenuTreeRow): MenuNode {
  return {
    code: r.code,
    name: r.name,
    description: r.description ?? undefined,
    isSummary: r.is_summary,
    moduleCode: r.module_code ?? undefined,
    // Window codes carry a `route:` prefix in the dictionary; a menu serves
    // the path itself.
    path: r.window_code === null ? undefined : r.window_code.replace(/^route:/, ""),
    isExternalAllowed: r.is_external_allowed,
    requiredPermissions: r.required_permissions,
    seqNo: r.seq_no,
    children: [],
  };
}

function mapTab(r: any): AppTab {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    windowId: r.window_id,
    code: r.code,
    name: r.name,
    description: r.description ?? undefined,
    sequenceNo: r.sequence_no,
    tabType: r.tab_type,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapProcess(r: any): AppProcess {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    code: r.code,
    name: r.name,
    description: r.description ?? undefined,
    moduleCode: r.module_code,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapTable(r: any): AppTable {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    code: r.code,
    name: r.name,
    description: r.description ?? undefined,
    moduleCode: r.module_code,
    physicalTableName: r.physical_table_name ?? undefined,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapField(r: any): AppField {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    tableId: r.table_id,
    code: r.code,
    name: r.name,
    description: r.description ?? undefined,
    sequenceNo: r.sequence_no,
    fieldType: r.field_type,
    isMandatory: r.is_mandatory,
    isReadonly: r.is_readonly,
    isVisible: r.is_visible,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapApiResource(r: any): AppApiResource {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    code: r.code,
    name: r.name,
    description: r.description ?? undefined,
    moduleCode: r.module_code,
    httpMethod: r.http_method,
    pathPattern: r.path_pattern,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapRuleVersion(r: any): AppFieldRuleVersion {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    tableId: r.table_id,
    versionNumber: r.version_number,
    status: r.status,
    isCurrent: r.is_current,
    rulesDefinition: r.rules_definition,
    publishedBy: r.published_by ?? undefined,
    publishedAt: r.published_at ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapFieldRule(r: any): AppFieldRule {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    tableId: r.table_id,
    fieldId: r.field_id,
    ruleType: r.rule_type,
    versionId: r.version_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class PgAppMetadataRepository implements AppMetadataRepository {
  constructor(private readonly pool: Pool) {}

  // --- Menu tree ------------------------------------------------------------

  /**
   * One row per menu node, carrying its own parent's code so the tree is
   * assembled without a second round trip. Ordered by `seq_no` then `code`:
   * every sibling list is therefore already in display order by the time it
   * is built, and no post-sort is needed.
   */
  async listMenuTree(tenantId: string): Promise<MenuNode[]> {
    const result = await this.pool.query(
      MENU_TREE_QUERY,
      [tenantId],
    );

    const byCode = new Map<string, MenuNode>();
    for (const r of result.rows as MenuTreeRow[]) {
      byCode.set(r.code, mapMenuRow(r));
    }

    const roots: MenuNode[] = [];
    for (const r of result.rows as MenuTreeRow[]) {
      const node = byCode.get(r.code)!;
      // A parent code missing from this map would mean a tree row hanging off
      // another tenant's menu; the tenant-scoped join makes that impossible,
      // so a miss here is only reachable if the node itself is absent.
      const parent = r.parent_code === null ? undefined : byCode.get(r.parent_code);
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  // --- Windows -------------------------------------------------------------

  async listWindowsByTenant(tenantId: string): Promise<AppWindow[]> {
    const result = await this.pool.query(
      `SELECT * FROM app_windows WHERE tenant_id = $1 ORDER BY module_code, code`,
      [tenantId],
    );
    return result.rows.map(mapWindow);
  }

  async getWindow(tenantId: string, windowId: string): Promise<AppWindow | null> {
    const result = await this.pool.query(
      `SELECT * FROM app_windows WHERE tenant_id = $1 AND id = $2`,
      [tenantId, windowId],
    );
    return result.rows[0] ? mapWindow(result.rows[0]) : null;
  }

  async getWindowByCode(tenantId: string, code: string): Promise<AppWindow | null> {
    const result = await this.pool.query(
      `SELECT * FROM app_windows WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    );
    return result.rows[0] ? mapWindow(result.rows[0]) : null;
  }

  async createWindow(
    tenantId: string,
    window: Omit<
      AppWindow,
      | "id"
      | "tenantId"
      | "createdAt"
      | "updatedAt"
      | "registrationStatus"
      | "requiredPermissions"
      | "parentPath"
    >,
  ): Promise<AppWindow> {
    // The three route columns are written as literals, not from the argument:
    // a window created here has no route behind it, so it starts unregistered
    // and cannot be role-locked (§4.2 "inti di kode").
    const result = await this.pool.query(
      `INSERT INTO app_windows (
         tenant_id, code, name, description, module_code,
         registration_status, required_permissions, parent_path,
         is_external_allowed, is_active
       )
       VALUES ($1, $2, $3, $4, $5, 'belum_terdaftar', '{}'::text[], NULL, $6, $7)
       RETURNING *`,
      [
        tenantId,
        window.code,
        window.name,
        window.description ?? null,
        window.moduleCode,
        window.isExternalAllowed,
        window.isActive,
      ],
    );
    return mapWindow(result.rows[0]);
  }

  async updateWindow(
    tenantId: string,
    windowId: string,
    updates: Partial<
      Omit<
        AppWindow,
        | "id"
        | "tenantId"
        | "createdAt"
        | "registrationStatus"
        | "requiredPermissions"
        | "parentPath"
      >
    >,
  ): Promise<AppWindow | null> {
    const existing = await this.getWindow(tenantId, windowId);
    if (!existing) return null;

    const merged = { ...existing, ...updates };
    // Code-owned route columns are absent from the SET list on purpose: no
    // update path may change whether a page renders or who may reach it.
    const result = await this.pool.query(
      `UPDATE app_windows
          SET name = $1, description = $2, module_code = $3,
              is_external_allowed = $4, is_active = $5, updated_at = now()
        WHERE tenant_id = $6 AND id = $7
        RETURNING *`,
      [
        merged.name,
        merged.description ?? null,
        merged.moduleCode,
        merged.isExternalAllowed,
        merged.isActive,
        tenantId,
        windowId,
      ],
    );
    return result.rows[0] ? mapWindow(result.rows[0]) : null;
  }

  // --- Tabs ------------------------------------------------------------------

  async listTabsByWindow(tenantId: string, windowId: string): Promise<AppTab[]> {
    const result = await this.pool.query(
      `SELECT * FROM app_tabs WHERE tenant_id = $1 AND window_id = $2 ORDER BY sequence_no, code`,
      [tenantId, windowId],
    );
    return result.rows.map(mapTab);
  }

  async getTab(tenantId: string, tabId: string): Promise<AppTab | null> {
    const result = await this.pool.query(
      `SELECT * FROM app_tabs WHERE tenant_id = $1 AND id = $2`,
      [tenantId, tabId],
    );
    return result.rows[0] ? mapTab(result.rows[0]) : null;
  }

  async createTab(
    tenantId: string,
    tab: Omit<AppTab, "id" | "createdAt" | "updatedAt">,
  ): Promise<AppTab> {
    const result = await this.pool.query(
      `INSERT INTO app_tabs (tenant_id, window_id, code, name, description, sequence_no, tab_type, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        tenantId,
        tab.windowId,
        tab.code,
        tab.name,
        tab.description ?? null,
        tab.sequenceNo,
        tab.tabType,
        tab.isActive,
      ],
    );
    return mapTab(result.rows[0]);
  }

  async updateTab(
    tenantId: string,
    tabId: string,
    updates: Partial<Omit<AppTab, "id" | "tenantId" | "windowId" | "createdAt">>,
  ): Promise<AppTab | null> {
    const existing = await this.getTab(tenantId, tabId);
    if (!existing) return null;

    const merged = { ...existing, ...updates };
    const result = await this.pool.query(
      `UPDATE app_tabs
          SET name = $1, description = $2, sequence_no = $3, tab_type = $4, is_active = $5, updated_at = now()
        WHERE tenant_id = $6 AND id = $7
        RETURNING *`,
      [merged.name, merged.description ?? null, merged.sequenceNo, merged.tabType, merged.isActive, tenantId, tabId],
    );
    return result.rows[0] ? mapTab(result.rows[0]) : null;
  }

  // --- Processes ---------------------------------------------------------

  async listProcessesByTenant(tenantId: string): Promise<AppProcess[]> {
    const result = await this.pool.query(
      `SELECT * FROM app_processes WHERE tenant_id = $1 ORDER BY module_code, code`,
      [tenantId],
    );
    return result.rows.map(mapProcess);
  }

  async getProcess(tenantId: string, processId: string): Promise<AppProcess | null> {
    const result = await this.pool.query(
      `SELECT * FROM app_processes WHERE tenant_id = $1 AND id = $2`,
      [tenantId, processId],
    );
    return result.rows[0] ? mapProcess(result.rows[0]) : null;
  }

  async getProcessByCode(tenantId: string, code: string): Promise<AppProcess | null> {
    const result = await this.pool.query(
      `SELECT * FROM app_processes WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    );
    return result.rows[0] ? mapProcess(result.rows[0]) : null;
  }

  async createProcess(
    tenantId: string,
    process: Omit<AppProcess, "id" | "createdAt" | "updatedAt">,
  ): Promise<AppProcess> {
    const result = await this.pool.query(
      `INSERT INTO app_processes (tenant_id, code, name, description, module_code, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [tenantId, process.code, process.name, process.description ?? null, process.moduleCode, process.isActive],
    );
    return mapProcess(result.rows[0]);
  }

  async updateProcess(
    tenantId: string,
    processId: string,
    updates: Partial<Omit<AppProcess, "id" | "tenantId" | "createdAt">>,
  ): Promise<AppProcess | null> {
    const existing = await this.getProcess(tenantId, processId);
    if (!existing) return null;

    const merged = { ...existing, ...updates };
    const result = await this.pool.query(
      `UPDATE app_processes
          SET name = $1, description = $2, module_code = $3, is_active = $4, updated_at = now()
        WHERE tenant_id = $5 AND id = $6
        RETURNING *`,
      [merged.name, merged.description ?? null, merged.moduleCode, merged.isActive, tenantId, processId],
    );
    return result.rows[0] ? mapProcess(result.rows[0]) : null;
  }

  // --- Tables --------------------------------------------------------------

  async listTablesByTenant(tenantId: string): Promise<AppTable[]> {
    const result = await this.pool.query(
      `SELECT * FROM app_tables WHERE tenant_id = $1 ORDER BY module_code, code`,
      [tenantId],
    );
    return result.rows.map(mapTable);
  }

  async getTable(tenantId: string, tableId: string): Promise<AppTable | null> {
    const result = await this.pool.query(
      `SELECT * FROM app_tables WHERE tenant_id = $1 AND id = $2`,
      [tenantId, tableId],
    );
    return result.rows[0] ? mapTable(result.rows[0]) : null;
  }

  async getTableByCode(tenantId: string, code: string): Promise<AppTable | null> {
    const result = await this.pool.query(
      `SELECT * FROM app_tables WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    );
    return result.rows[0] ? mapTable(result.rows[0]) : null;
  }

  async createTable(
    tenantId: string,
    table: Omit<AppTable, "id" | "createdAt" | "updatedAt">,
  ): Promise<AppTable> {
    const result = await this.pool.query(
      `INSERT INTO app_tables (tenant_id, code, name, description, module_code, physical_table_name, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        tenantId,
        table.code,
        table.name,
        table.description ?? null,
        table.moduleCode,
        table.physicalTableName ?? null,
        table.isActive,
      ],
    );
    return mapTable(result.rows[0]);
  }

  async updateTable(
    tenantId: string,
    tableId: string,
    updates: Partial<Omit<AppTable, "id" | "tenantId" | "createdAt">>,
  ): Promise<AppTable | null> {
    const existing = await this.getTable(tenantId, tableId);
    if (!existing) return null;

    const merged = { ...existing, ...updates };
    const result = await this.pool.query(
      `UPDATE app_tables
          SET name = $1, description = $2, module_code = $3, physical_table_name = $4, is_active = $5, updated_at = now()
        WHERE tenant_id = $6 AND id = $7
        RETURNING *`,
      [
        merged.name,
        merged.description ?? null,
        merged.moduleCode,
        merged.physicalTableName ?? null,
        merged.isActive,
        tenantId,
        tableId,
      ],
    );
    return result.rows[0] ? mapTable(result.rows[0]) : null;
  }

  // --- Fields --------------------------------------------------------------

  async listFieldsByTable(tenantId: string, tableId: string): Promise<AppField[]> {
    const result = await this.pool.query(
      `SELECT * FROM app_fields WHERE tenant_id = $1 AND table_id = $2 ORDER BY sequence_no, code`,
      [tenantId, tableId],
    );
    return result.rows.map(mapField);
  }

  async getField(tenantId: string, fieldId: string): Promise<AppField | null> {
    const result = await this.pool.query(
      `SELECT * FROM app_fields WHERE tenant_id = $1 AND id = $2`,
      [tenantId, fieldId],
    );
    return result.rows[0] ? mapField(result.rows[0]) : null;
  }

  async getFieldByCode(tenantId: string, tableId: string, code: string): Promise<AppField | null> {
    const result = await this.pool.query(
      `SELECT * FROM app_fields WHERE tenant_id = $1 AND table_id = $2 AND code = $3`,
      [tenantId, tableId, code],
    );
    return result.rows[0] ? mapField(result.rows[0]) : null;
  }

  async createField(
    tenantId: string,
    field: Omit<AppField, "id" | "createdAt" | "updatedAt">,
  ): Promise<AppField> {
    const result = await this.pool.query(
      `INSERT INTO app_fields
         (tenant_id, table_id, code, name, description, sequence_no, field_type, is_mandatory, is_readonly, is_visible, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        tenantId,
        field.tableId,
        field.code,
        field.name,
        field.description ?? null,
        field.sequenceNo,
        field.fieldType,
        field.isMandatory,
        field.isReadonly,
        field.isVisible,
        field.isActive,
      ],
    );
    return mapField(result.rows[0]);
  }

  async updateField(
    tenantId: string,
    fieldId: string,
    updates: Partial<Omit<AppField, "id" | "tenantId" | "tableId" | "createdAt">>,
  ): Promise<AppField | null> {
    const existing = await this.getField(tenantId, fieldId);
    if (!existing) return null;

    const merged = { ...existing, ...updates };
    const result = await this.pool.query(
      `UPDATE app_fields
          SET name = $1, description = $2, sequence_no = $3, field_type = $4,
              is_mandatory = $5, is_readonly = $6, is_visible = $7, is_active = $8, updated_at = now()
        WHERE tenant_id = $9 AND id = $10
        RETURNING *`,
      [
        merged.name,
        merged.description ?? null,
        merged.sequenceNo,
        merged.fieldType,
        merged.isMandatory,
        merged.isReadonly,
        merged.isVisible,
        merged.isActive,
        tenantId,
        fieldId,
      ],
    );
    return result.rows[0] ? mapField(result.rows[0]) : null;
  }

  // --- API Resources -------------------------------------------------------

  async listApiResourcesByTenant(tenantId: string): Promise<AppApiResource[]> {
    const result = await this.pool.query(
      `SELECT * FROM app_api_resources WHERE tenant_id = $1 ORDER BY module_code, code`,
      [tenantId],
    );
    return result.rows.map(mapApiResource);
  }

  async getApiResource(tenantId: string, resourceId: string): Promise<AppApiResource | null> {
    const result = await this.pool.query(
      `SELECT * FROM app_api_resources WHERE tenant_id = $1 AND id = $2`,
      [tenantId, resourceId],
    );
    return result.rows[0] ? mapApiResource(result.rows[0]) : null;
  }

  async getApiResourceByCode(tenantId: string, code: string): Promise<AppApiResource | null> {
    const result = await this.pool.query(
      `SELECT * FROM app_api_resources WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    );
    return result.rows[0] ? mapApiResource(result.rows[0]) : null;
  }

  async createApiResource(
    tenantId: string,
    resource: Omit<AppApiResource, "id" | "createdAt" | "updatedAt">,
  ): Promise<AppApiResource> {
    const result = await this.pool.query(
      `INSERT INTO app_api_resources (tenant_id, code, name, description, module_code, http_method, path_pattern, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        tenantId,
        resource.code,
        resource.name,
        resource.description ?? null,
        resource.moduleCode,
        resource.httpMethod,
        resource.pathPattern,
        resource.isActive,
      ],
    );
    return mapApiResource(result.rows[0]);
  }

  async updateApiResource(
    tenantId: string,
    resourceId: string,
    updates: Partial<Omit<AppApiResource, "id" | "tenantId" | "createdAt">>,
  ): Promise<AppApiResource | null> {
    const existing = await this.getApiResource(tenantId, resourceId);
    if (!existing) return null;

    const merged = { ...existing, ...updates };
    const result = await this.pool.query(
      `UPDATE app_api_resources
          SET name = $1, description = $2, module_code = $3, http_method = $4,
              path_pattern = $5, is_active = $6, updated_at = now()
        WHERE tenant_id = $7 AND id = $8
        RETURNING *`,
      [
        merged.name,
        merged.description ?? null,
        merged.moduleCode,
        merged.httpMethod,
        merged.pathPattern,
        merged.isActive,
        tenantId,
        resourceId,
      ],
    );
    return result.rows[0] ? mapApiResource(result.rows[0]) : null;
  }

  // --- Field Rules (Versioned Structured Rules) --------------------------

  async getCurrentRuleVersion(tenantId: string, tableId: string): Promise<AppFieldRuleVersion | null> {
    const result = await this.pool.query(
      `SELECT * FROM app_field_rules_versions WHERE tenant_id = $1 AND table_id = $2 AND is_current = true`,
      [tenantId, tableId],
    );
    return result.rows[0] ? mapRuleVersion(result.rows[0]) : null;
  }

  async getRuleVersion(tenantId: string, versionId: string): Promise<AppFieldRuleVersion | null> {
    const result = await this.pool.query(
      `SELECT * FROM app_field_rules_versions WHERE tenant_id = $1 AND id = $2`,
      [tenantId, versionId],
    );
    return result.rows[0] ? mapRuleVersion(result.rows[0]) : null;
  }

  async listRuleVersionsByTable(tenantId: string, tableId: string): Promise<AppFieldRuleVersion[]> {
    const result = await this.pool.query(
      `SELECT * FROM app_field_rules_versions WHERE tenant_id = $1 AND table_id = $2 ORDER BY version_number DESC`,
      [tenantId, tableId],
    );
    return result.rows.map(mapRuleVersion);
  }

  async createRuleVersion(
    tenantId: string,
    tableId: string,
    versionNumber: number,
    rulesDefinition: AppFieldRuleVersion["rulesDefinition"],
  ): Promise<AppFieldRuleVersion> {
    const result = await this.pool.query(
      `INSERT INTO app_field_rules_versions (tenant_id, table_id, version_number, status, is_current, rules_definition)
       VALUES ($1, $2, $3, 'draft', false, $4)
       RETURNING *`,
      [tenantId, tableId, versionNumber, JSON.stringify(rulesDefinition)],
    );
    return mapRuleVersion(result.rows[0]);
  }

  /** Publish: set this version published+current, retire the previous current in the same transaction. */
  async publishRuleVersion(tenantId: string, versionId: string, publishedBy: string): Promise<AppFieldRuleVersion> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const target = await client.query(
        `SELECT * FROM app_field_rules_versions WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, versionId],
      );
      if (!target.rows[0]) {
        throw new Error(`AppFieldRuleVersion ${versionId} not found`);
      }
      const tableId = target.rows[0].table_id;

      // Retire whatever is currently current for this table (partial unique
      // index app_field_rules_versions_one_current_per_table forbids two
      // is_current=true rows, so the old current must drop first).
      await client.query(
        `UPDATE app_field_rules_versions
            SET is_current = false, status = 'retired', updated_at = now()
          WHERE tenant_id = $1 AND table_id = $2 AND is_current = true AND id != $3`,
        [tenantId, tableId, versionId],
      );

      const published = await client.query(
        `UPDATE app_field_rules_versions
            SET status = 'published', is_current = true, published_by = $1, published_at = now(), updated_at = now()
          WHERE tenant_id = $2 AND id = $3
          RETURNING *`,
        [publishedBy, tenantId, versionId],
      );

      await client.query("COMMIT");
      return mapRuleVersion(published.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async retireRuleVersion(tenantId: string, versionId: string): Promise<AppFieldRuleVersion> {
    const result = await this.pool.query(
      `UPDATE app_field_rules_versions
          SET status = 'retired', is_current = false, updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      [tenantId, versionId],
    );
    if (!result.rows[0]) {
      throw new Error(`AppFieldRuleVersion ${versionId} not found`);
    }
    return mapRuleVersion(result.rows[0]);
  }

  async getRulesByField(tenantId: string, fieldId: string): Promise<AppFieldRule[]> {
    const result = await this.pool.query(
      `SELECT * FROM app_field_rules WHERE tenant_id = $1 AND field_id = $2`,
      [tenantId, fieldId],
    );
    return result.rows.map(mapFieldRule);
  }

  async createFieldRule(
    tenantId: string,
    fieldRule: Omit<AppFieldRule, "id" | "createdAt" | "updatedAt">,
  ): Promise<AppFieldRule> {
    const result = await this.pool.query(
      `INSERT INTO app_field_rules (tenant_id, table_id, field_id, rule_type, version_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [tenantId, fieldRule.tableId, fieldRule.fieldId, fieldRule.ruleType, fieldRule.versionId],
    );
    return mapFieldRule(result.rows[0]);
  }

  async deleteFieldRule(tenantId: string, ruleId: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM app_field_rules WHERE tenant_id = $1 AND id = $2`,
      [tenantId, ruleId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
