/**
 * Application Dictionary entities (kamus aplikasi)
 *
 * Follows ADR-0014: inti di kode, penimpa di database.
 * - Inti: core definitions come from migration and code
 * - Penimpa: overrides stored in database
 *
 * All entities are tenant-scoped.
 */

/** Window: a page or route in the application */
export interface AppWindow {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description?: string;
  moduleCode: string;
  /**
   * Route registration status (§4.3). Routes seeded by the auto-registration
   * migration carry `di_menu` or `tersembunyi`; a window created without a
   * route (e.g. by hand in the dictionary screen) defaults to
   * `belum_terdaftar` and cannot be role-locked yet.
   */
  registrationStatus: "di_menu" | "tersembunyi" | "belum_terdaftar";
  /** "any of" permission codes; empty = authenticated-only. */
  requiredPermissions: string[];
  /** Parent route for detail pages that inherit the parent's access. */
  parentPath?: string;
  isExternalAllowed: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Menu node: one entry of the navigation tree (§4.3).
 *
 * The two-table split is deliberate (iDempiere's AD_Menu / AD_Tree_Menu):
 * `AppMenu` is WHAT the menu is — its code, label and destination — while the
 * tree row is only WHERE it hangs. Moving a menu therefore never rewrites its
 * definition, and the same definition may be re-hung without touching it.
 *
 * This is the shape the server serves. Wave 1 proved the served catalogue
 * matched the navigation of the day; Wave 2 filters it per caller in
 * `menu-filter.ts` before it leaves the server, which is where `locked` and
 * `lockedReason` are set.
 */
export interface MenuNode {
  /** Stable code, locked in code. Example: nav-operations-work-orders. */
  code: string;
  name: string;
  description?: string;
  /** `true` = a folder (Grup, Modul); only a folder has children. */
  isSummary: boolean;
  /** Module this menu belongs to; mandatory for a page, absent for a folder. */
  moduleCode?: string;
  /** Route this menu opens, resolved from its window. Absent for a folder. */
  path?: string;
  /** The external whitelist flag. Default closed. */
  isExternalAllowed: boolean;
  /** "any of" permission codes the server-side filter uses (Wave 2). */
  requiredPermissions: string[];
  /** Position among its siblings. */
  seqNo: number;
  children: MenuNode[];
  /**
   * Wave 2: the caller's role cannot open this page, but the module is active,
   * so the menu is sent in a disabled state with a reason rather than hidden
   * (§4.3 "MODUL AKTIF + role tidak boleh → menu tampil, NONAKTIF + keterangan").
   * `false` for folders and for pages the caller may open; only the server
   * sets it, never the client.
   */
  locked?: boolean;
  /** Why the menu is locked. Present only when `locked` is true. */
  lockedReason?: string;
}

/** Tab: a section within a window/page */
export interface AppTab {
  id: string;
  tenantId: string;
  windowId: string;
  code: string;
  name: string;
  description?: string;
  sequenceNo: number;
  tabType: "fields" | "cards" | "wizard";
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Process: an action or button */
export interface AppProcess {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description?: string;
  moduleCode: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Table: a data entity */
export interface AppTable {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description?: string;
  moduleCode: string;
  physicalTableName?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Field: a column on a table */
export interface AppField {
  id: string;
  tenantId: string;
  tableId: string;
  code: string;
  name: string;
  description?: string;
  sequenceNo: number;
  fieldType: string; // "text" | "number" | "date" | "boolean" | "reference"
  isMandatory: boolean;
  isReadonly: boolean;
  isVisible: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** API Resource: an HTTP endpoint */
export interface AppApiResource {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description?: string;
  moduleCode: string;
  httpMethod: string; // GET, POST, PUT, DELETE, etc.
  pathPattern: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Structured rule operator: no DSL, only typed operators.
 *
 * Locked Wave 1 set (9). `in`/`notIn` compare membership in an array value;
 * `isNull` tests presence, so its value is a boolean (`true` = the field must
 * be absent/null, `false` = it must be present). No other value shape is
 * meaningful for those three and the validator enforces that.
 *
 * Wave 3 may extend this set, but extending it means every rule version
 * already stored has to be re-read under the wider set — so the set is
 * widened deliberately, not by adding an operator inline. */
export type RuleOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "notIn"
  | "isNull";

/** Single rule: field + operator + value */
export interface FieldRuleCondition {
  field: string; // dot-notation path, e.g. "amount", "status"
  operator: RuleOperator;
  value: unknown;
}

/** Rule combination: multiple rules with AND/OR */
export interface RuleCombination {
  rules: FieldRuleCondition[];
  combinator: "AND" | "OR";
}

/** Field rule: applied to a field, links to a version */
export interface AppFieldRule {
  id: string;
  tenantId: string;
  tableId: string;
  fieldId: string;
  ruleType: "mandatory" | "readonly" | "visible";
  versionId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Versioned field rules: draft → publish → version lifecycle */
export interface AppFieldRuleVersion {
  id: string;
  tenantId: string;
  tableId: string;
  versionNumber: number;
  status: "draft" | "published" | "retired";
  isCurrent: boolean;
  rulesDefinition: {
    rules: Array<{
      field: string;
      ruleType: "mandatory" | "readonly" | "visible";
      conditions: RuleCombination;
    }>;
  };
  publishedBy?: string; // user ID
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
