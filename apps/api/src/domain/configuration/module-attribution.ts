/**
 * Module attribution — the code-owned rule set that assigns each permission,
 * each API path segment, and each route to exactly one module in `modules`
 * (Epic 2 Wave 1, CORE-ROADMAP.md §4.2).
 *
 * Why this file exists. Wave 1 registers three dictionary objects
 * automatically — `app_processes` (one row per permission), `app_api_resources`
 * (one row per HTTP route), and the already-shipped `app_windows` (one row per
 * client route). Every one of those objects carries `module_code`, and
 * `modules` holds exactly fourteen real codes. Nothing in the schema ties a
 * permission or an API path to its module, so without a stated rule the
 * automation would have to guess — and a guess here is what §4.3 calls
 * "kesalahan yang tidak terlihat": a page silently locked to the wrong module,
 * or silently never lockable at all.
 *
 * Locked decision (ADR-0014, §4.2): "inti di kode, penimpa di database". This
 * file is the core definition. It is seeded into the database by the tenant
 * trigger and backfill in the Wave 1 dictionary-seed migration, and the parity
 * test compares the seeded rows against this file so the two cannot drift.
 *
 * Three derivations, each with a stated source of truth:
 *
 *   1. `attributePermission` — from the module that owns the service checking
 *      the permission. Verified against every `requirePermission` call site:
 *      the prefix families below are exactly the service file locations, and
 *      the `PERMISSION_MODULE_EXCEPTIONS` list holds every permission whose
 *      owner is not implied by its prefix.
 *
 *   2. `attributeApiSegment` — from the first path segment of the route. The
 *      API surface is grouped by resource noun, and the noun names the module.
 *      Where one module publishes under more than one noun (`/wms` and
 *      `/supply-chain/advanced` both being warehouse), both map to it.
 *
 *   3. Route attribution is NOT here — it is already stated per route in
 *      `route-registry.ts`, which is the canonical source for `app_windows`.
 *
 * No expression text, no heuristic scoring: a plain table, longest prefix
 * first, with an explicit exception list. A permission or segment that matches
 * nothing resolves to `undefined` and the caller must report it — never
 * silently default it.
 */

/** The fourteen codes present in `modules`. Kept as a literal union so a
 * typo in a rule below is a compile error rather than a row that fails to
 * resolve at seed time. */
export type ModuleCode =
  | "asset"
  | "customer_commercial"
  | "customer_complaint"
  | "finance"
  | "hse"
  | "platform"
  | "procurement_management"
  | "project_delivery"
  | "reporting_insight"
  | "service_operations"
  | "supply_chain"
  | "survey_assessment"
  | "warehouse_management"
  | "workforce";

export const MODULE_CODES: readonly ModuleCode[] = [
  "asset",
  "customer_commercial",
  "customer_complaint",
  "finance",
  "hse",
  "platform",
  "procurement_management",
  "project_delivery",
  "reporting_insight",
  "service_operations",
  "supply_chain",
  "survey_assessment",
  "warehouse_management",
  "workforce",
];

/**
 * Permissions whose owning module is not implied by their prefix.
 *
 * Read this as "the module that owns the service which checks this code",
 * never as "the module whose name sounds closest". Each entry is justified
 * against its call site.
 */
export const PERMISSION_MODULE_EXCEPTIONS: Readonly<Record<string, ModuleCode>> = {
  // Customer & Commercial services. These prefixes are domain nouns shared
  // across modules, so the prefix rule cannot decide them:
  //   contract.service.ts, customer.service.ts, project.service.ts,
  //   sales.service.ts, service-catalog.service.ts, site.service.ts
  // — all under `application/customer/` and `application/sales/`.
  "contract.read": "customer_commercial",
  "contract.manage": "customer_commercial",
  "customer.read": "customer_commercial",
  "customer.manage": "customer_commercial",
  "project.read": "customer_commercial",
  "project.manage": "customer_commercial",
  "sales.read": "customer_commercial",
  "sales.manage": "customer_commercial",
  "sales.approve": "customer_commercial",
  "sales.configure": "customer_commercial",
  "service.read": "customer_commercial",
  "service.manage": "customer_commercial",
  "site.read": "customer_commercial",
  "site.manage": "customer_commercial",

  // Service Quality is the service_quality.* family but lives in the
  // customer_complaint module: `route-registry.ts` puts `/service-quality`
  // under `customer_complaint`, and `service-quality.service.ts` owns both
  // the complaint lifecycle and its quality analytics.
  // (Handled by the `service_quality.` prefix rule below — listed here only
  // as documentation of the deliberate exception to name-matching.)

  // Documents are a platform-level shared service (`document.service.ts`),
  // not a module's private surface.
  "document.read": "platform",
  "document.manage": "platform",
};

/**
 * Prefix rules, longest first at lookup time. The list is written in
 * reading order; `attributePermission` sorts by descending prefix length so
 * `supply_chain.warehouse_task.` wins over `supply_chain.warehouse.` and both
 * win over `supply_chain.`.
 *
 * The `supply_chain.*` family is deliberately split across three modules. The
 * boundary follows 1784000000000_wave-a5-1-stage-3-module-catalog.cjs
 * verbatim: shared master data (items, suppliers, purchase requests/orders)
 * stays `supply_chain`; physical inventory custody and valuation is
 * `warehouse_management`; strategic sourcing, contracts, service acceptance
 * and spend analytics is `procurement_management`.
 */
export const PERMISSION_MODULE_PREFIXES: ReadonlyArray<readonly [string, ModuleCode]> = [
  // Supply Chain — warehouse custody and valuation.
  ["supply_chain.warehouse_task.", "warehouse_management"],
  ["supply_chain.warehouse.", "warehouse_management"],
  ["supply_chain.valuation.", "warehouse_management"],
  ["supply_chain.inventory.", "warehouse_management"],
  ["supply_chain.disposal.", "warehouse_management"],
  ["supply_chain.consignment.", "warehouse_management"],
  ["supply_chain.receiving.", "warehouse_management"],

  // Supply Chain — sourcing, contracts, acceptance, analytics.
  ["supply_chain.service_acceptance.", "procurement_management"],
  ["supply_chain.procurement.", "procurement_management"],
  ["supply_chain.contract.", "procurement_management"],
  ["supply_chain.analytics.", "procurement_management"],

  // Supply Chain — Accounting-readiness hooks and returns-to-vendor stay with
  // the SCM core: returns are a custody reversal owned by the supply-chain
  // service, and account assignment is the SCM-side validation of Finance's
  // posting readiness (ADR-0023 keeps Finance the owner of the posting side).
  ["supply_chain.account_assignment.", "supply_chain"],
  ["supply_chain.accounting_event.", "supply_chain"],
  ["supply_chain.return.", "supply_chain"],
  ["supply_chain.", "supply_chain"],

  // Service surfaces.
  ["service_operations.", "service_operations"],
  ["service_quality.", "customer_complaint"],

  // Remaining module prefixes.
  ["project_delivery.", "project_delivery"],
  ["reporting.", "reporting_insight"],
  ["workforce.", "workforce"],
  ["complaint.", "customer_complaint"],
  ["survey.", "survey_assessment"],
  ["finance.", "finance"],
  ["asset.", "asset"],
  ["hse.", "hse"],

  // Platform — identity, tenancy, configuration and cross-module plumbing.
  ["admin.", "platform"],
  ["audit_log.", "platform"],
  ["config.", "platform"],
  ["integration.", "platform"],
  ["legal_entity.", "platform"],
  ["notification.", "platform"],
  ["observability.", "platform"],
  ["organization_unit.", "platform"],
  ["scheduler.", "platform"],
  ["tenant.", "platform"],
  ["user.", "platform"],
  ["workflow.", "platform"],
];

/** Prefix rules held longest-first, so a longer, more specific prefix always
 * beats a shorter one that is also a prefix of the code. */
const PREFIXES_LONGEST_FIRST = [...PERMISSION_MODULE_PREFIXES].sort(
  (a, b) => b[0].length - a[0].length,
);

/**
 * Resolve the owning module for a permission code.
 *
 * Exact exceptions win over prefixes. Returns `undefined` when nothing
 * matches: the caller must report an unattributed permission, because a
 * permission with no module cannot be locked to a role under §4.4.
 */
export function attributePermission(code: string): ModuleCode | undefined {
  const exact = PERMISSION_MODULE_EXCEPTIONS[code];
  if (exact !== undefined) return exact;
  for (const [prefix, moduleCode] of PREFIXES_LONGEST_FIRST) {
    if (code.startsWith(prefix)) return moduleCode;
  }
  return undefined;
}

/**
 * First-path-segment → module for API resources.
 *
 * Every route registered on the API server has exactly one first segment, and
 * this table covers all of them. Segments are the resource noun the routes are
 * grouped under, which is why `items` and `purchase-orders` sit under
 * `supply_chain` while `wms` sits under `warehouse_management` — the same
 * split the permission table makes.
 */
export const API_SEGMENT_MODULES: Readonly<Record<string, ModuleCode>> = {
  // Platform.
  admin: "platform",
  "app-metadata": "platform",
  "audit-log": "platform",
  auth: "platform",
  config: "platform",
  documents: "platform",
  health: "platform",
  integration: "platform",
  "legal-entities": "platform",
  me: "platform",
  notifications: "platform",
  observability: "platform",
  "organization-units": "platform",
  scheduler: "platform",
  tenants: "platform",
  users: "platform",
  workflow: "platform",

  // Asset.
  assets: "asset",
  "asset-movements": "asset",

  // Customer Complaint (includes Service Quality).
  complaints: "customer_complaint",
  "service-quality": "customer_complaint",

  // Customer & Commercial.
  contracts: "customer_commercial",
  "customer-contacts": "customer_commercial",
  "customer-service-links": "customer_commercial",
  customers: "customer_commercial",
  projects: "customer_commercial",
  sales: "customer_commercial",
  services: "customer_commercial",
  sites: "customer_commercial",

  // Finance.
  finance: "finance",

  // HSE.
  hse: "hse",

  // Project Delivery.
  "project-delivery": "project_delivery",

  // Reporting & Insight.
  reporting: "reporting_insight",

  // Service Operations.
  "service-definitions": "service_operations",
  "service-operations": "service_operations",
  "work-orders": "service_operations",
  "work-requests": "service_operations",

  // Supply Chain — shared master data and purchasing.
  items: "supply_chain",
  "purchase-orders": "supply_chain",
  "purchase-requests": "supply_chain",
  stock: "supply_chain",
  suppliers: "supply_chain",
  "supply-chain": "supply_chain",

  // Procurement Management.
  procurement: "procurement_management",

  // Warehouse Management.
  wms: "warehouse_management",

  // Survey & Assessment (includes the public response entry point).
  public: "survey_assessment",
  "survey-assignments": "survey_assessment",
  "survey-distribution-tokens": "survey_assessment",
  "survey-questions": "survey_assessment",
  "survey-versions": "survey_assessment",
  surveys: "survey_assessment",

  // Workforce.
  employees: "workforce",
  positions: "workforce",
  workforce: "workforce",
};

/**
 * Resolve the owning module for an API route path.
 *
 * The path arrives as Fastify declares it (`/wms/warehouses/:id`), so the
 * caller passes the raw route URL. A path with no first segment (the root)
 * resolves to `undefined` and must be reported rather than defaulted.
 */
export function attributeApiPath(path: string): ModuleCode | undefined {
  const segment = path.replace(/^\//, "").split("/")[0];
  if (segment === "" || segment.startsWith(":")) return undefined;
  return API_SEGMENT_MODULES[segment];
}
