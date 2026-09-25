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
  isExternalAllowed: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
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
