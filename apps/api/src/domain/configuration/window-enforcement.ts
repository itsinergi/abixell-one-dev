/**
 * Window read-only enforcement (Epic 4 Wave 1, CORE-ROADMAP.md §4.4 step 11b).
 *
 * The third authorization layer. §4.3 fixes the model as four layers —
 * module activation → permission → per-role Window lock → data scope — and the
 * first two already have serverside enforcement. This file adds the third:
 *
 *   a role holding only `*.read` must be able to OPEN a Window and must be
 *   unable to WRITE through it. `role_window_access.is_read_write = false`
 *   is the record of that intent.
 *
 * Until now the lock was configuration only. `loadRoleDefinition` returned the
 * literal `not_enforced` precisely so the API did not claim otherwise. Step 11b
 * is what makes the claim true, and it is delivered in the shape the roadmap
 * asks for: "petakan API Resource ke Window secara eksplisit di server".
 *
 * ── The mapping is by hand, and that is the point ──────────────────────────
 *
 * A Window is a client route (`/wms/warehouses`); an API Resource is a server
 * route (`PATCH /wms/warehouses/:id`). Nothing derives one from the other
 * reliably — `PATCH /assets/schedules/:id` belongs to the maintenance Window,
 * not the assets Window, and no string rule would say so. The table below is
 * therefore literal: every row names the exact `route:` code it belongs to.
 *
 * The consequence is deliberately asymmetric. A route with no rule resolves to
 * `undefined` and is passed through, because "not yet mapped" is not the same
 * claim as "read-only" — treating them alike would either break every tenant on
 * day one or silently lock modules nobody configured. What keeps the gap from
 * being invisible is the census below plus
 * `window-enforcement-coverage.test.ts`: every mutating route the server
 * declares is recorded as governed, exempt, or unaccounted for, and an
 * unaccounted one is a defect the test reports. §4.4 states the same rule:
 * "Modul lain belum boleh dianggap tertutup."
 *
 * ── Three states, not two ─────────────────────────────────────────────────
 *
 *   1. No `role_window_access` row for any effective assignment  → allowed.
 *      The table ships empty (11a writes it per Role), so absence means
 *      "this Role was never configured for this Window", not "read-only".
 *      Reading absence as read-only would lock every Role out of every Window
 *      the moment this was deployed.
 *
 *   2. Rows exist, none of them `is_read_write AND is_active` → 403. A row that
 *      is inactive is the roadmap's "read-only atau inactive"; both refuse.
 *
 *   3. Any row with `is_read_write AND is_active` → allowed. Union allow: one
 *      effective assignment with write is enough, even when another Role the
 *      user holds is read-only for the same Window.
 *
 * ── Who is exempt ─────────────────────────────────────────────────────────
 *
 * Nobody, unlike the module-active rule, which exempts `platform` because the
 * route that activates a module would otherwise be unreachable on a tenant with
 * no activations. The failure modes are not alike. Module activity is one
 * tenant-wide state that only the platform route can repair. A Window lock is
 * per Role and removable by any other Role that holds the Window; exempting
 * `platform` here would make `route:/admin` and `route:/administration`
 * decorative for exactly the Roles most likely to be over-privileged. The
 * self-lockout an administrator can still reach — locking their own Role's
 * Window — is a consequence of a decision they made and can see, not a hole.
 *
 * Reads are never touched: "tetap dapat membuka Window-nya". The check is on
 * POST/PUT/PATCH/DELETE only, the same set `module-enforcement.ts` uses.
 *
 * Pure and total: it decides, it does not act. The wiring is in
 * `window-access-plugin.ts`, and the repository supplies the one fact this file
 * cannot know — what the caller's effective assignments say.
 */

import { MUTATING_METHODS, type MutatingMethod } from "./module-enforcement.js";
import { resolveRouteEntry } from "./route-registry.js";

export { MUTATING_METHODS };
export type { MutatingMethod };

/** §4.4 step 11b: the message a locked-out writer reads. */
export const WINDOW_READ_ONLY_REASON =
  "Peran Anda hanya berhak membaca pada halaman ini.";

/**
 * Every prefix that is a client route: Window codes are `route:<client path>`.
 * Declared here rather than imported so this module stays buildable without a
 * database — but `windowsWithEnforcement()` below validates every literal in
 * `WINDOW_RULES` against `ROUTE_REGISTRY`, and the coverage test fails on a
 * Window code that names a route the application does not serve.
 */
export const WINDOW_CODE_PREFIX = "route:";

export interface WindowRule {
  /** Exact HTTP method, or `*` for every mutating method. A rule with an exact
   *  method wins a tie against `*` on the same prefix. */
  method: MutatingMethod | "*";
  /**
   * Server route pattern as Fastify declares it, or a prefix of one. Matched
   * segment-wise: `/assets/:id` matches `/assets/:id/downtime` but never
   * `/assets-maintenance`. Longest pattern wins.
   */
  apiPath: string;
  /** The client Window this route writes through. */
  windowCode: string;
}

/**
 * API Resource → Window, by hand, one row per claim.
 *
 * Ordering inside the array carries no meaning; resolution sorts by pattern
 * length. The array is grouped by module so the coverage test's gap list stays
 * readable, and so a reviewer can see which modules are closed and which are
 * still open at a glance.
 */
export const WINDOW_RULES: WindowRule[] = [
  // --- customer_complaint --------------------------------------------------
  { method: "POST", apiPath: "/complaints", windowCode: "route:/complaints" },
  { method: "*", apiPath: "/complaints/config", windowCode: "route:/administration/complaints" },
  { method: "*", apiPath: "/complaints/:id", windowCode: "route:/complaints/:complaintId" },
  { method: "*", apiPath: "/service-quality", windowCode: "route:/service-quality" },

  // --- survey_assessment ---------------------------------------------------
  // The answer/submit writes are the respondent's own Window, so they outrank
  // the authoring Window on the shared `/survey-assignments` prefix.
  { method: "*", apiPath: "/public/surveys/:token", windowCode: "route:/public/surveys/:token" },
  { method: "*", apiPath: "/survey-assignments/:id", windowCode: "route:/my-surveys/:assignmentId" },
  { method: "*", apiPath: "/survey-assignments", windowCode: "route:/surveys/:code" },
  { method: "*", apiPath: "/survey-distribution-tokens", windowCode: "route:/surveys/:code" },
  { method: "*", apiPath: "/survey-questions", windowCode: "route:/surveys" },
  { method: "*", apiPath: "/survey-versions", windowCode: "route:/surveys" },
  { method: "*", apiPath: "/surveys/:code", windowCode: "route:/surveys/:code" },
  { method: "*", apiPath: "/surveys", windowCode: "route:/surveys" },

  // --- service_operations --------------------------------------------------
  { method: "*", apiPath: "/work-orders/:id", windowCode: "route:/work-orders/:workOrderId" },
  { method: "*", apiPath: "/work-orders", windowCode: "route:/work-orders" },
  // A request is raised from, and converted into, a work order. There is no
  // `/work-requests` client route, so the work-order Window owns both.
  { method: "*", apiPath: "/work-requests", windowCode: "route:/work-orders" },
  { method: "*", apiPath: "/service-definitions", windowCode: "route:/service-types" },
  { method: "*", apiPath: "/service-operations/packs", windowCode: "route:/service-packs" },
  { method: "*", apiPath: "/service-operations/optimization", windowCode: "route:/service-optimization" },

  // --- customer_commercial -------------------------------------------------
  // `/projects` (customer_commercial) and `/project-delivery/projects` are
  // different modules with different Windows; the prefixes never overlap.
  { method: "*", apiPath: "/sales", windowCode: "route:/sales" },
  { method: "*", apiPath: "/contracts", windowCode: "route:/customer-commercial" },
  { method: "*", apiPath: "/customer-contacts", windowCode: "route:/customer-commercial" },
  { method: "*", apiPath: "/customer-service-links", windowCode: "route:/customer-commercial" },
  { method: "*", apiPath: "/customers", windowCode: "route:/customer-commercial" },
  { method: "*", apiPath: "/projects", windowCode: "route:/customer-commercial" },
  { method: "*", apiPath: "/services", windowCode: "route:/customer-commercial" },
  { method: "*", apiPath: "/sites", windowCode: "route:/customer-commercial" },

  // --- workforce -----------------------------------------------------------
  { method: "*", apiPath: "/workforce/advanced/attendance", windowCode: "route:/workforce/attendance" },
  { method: "*", apiPath: "/workforce/advanced/leave-requests", windowCode: "route:/workforce/leave-overtime" },
  { method: "*", apiPath: "/workforce/advanced/leave-types", windowCode: "route:/workforce/leave-overtime" },
  { method: "*", apiPath: "/workforce/advanced/leave-balances", windowCode: "route:/workforce/leave-overtime" },
  { method: "*", apiPath: "/workforce/advanced/overtime-requests", windowCode: "route:/workforce/leave-overtime" },
  { method: "*", apiPath: "/workforce/advanced/payroll-runs", windowCode: "route:/workforce/payroll" },
  { method: "*", apiPath: "/workforce/advanced/salary-profiles", windowCode: "route:/workforce/payroll" },
  { method: "*", apiPath: "/workforce/advanced/statutory-policies", windowCode: "route:/workforce/payroll" },
  { method: "*", apiPath: "/workforce/advanced/job-applications", windowCode: "route:/workforce/recruitment" },
  { method: "*", apiPath: "/workforce/advanced/job-postings", windowCode: "route:/workforce/recruitment" },
  { method: "*", apiPath: "/workforce/advanced/competencies", windowCode: "route:/workforce/performance" },
  { method: "*", apiPath: "/workforce/advanced/career-paths", windowCode: "route:/workforce/performance" },
  { method: "*", apiPath: "/workforce/advanced/employee-competencies", windowCode: "route:/workforce/performance" },
  { method: "*", apiPath: "/workforce/advanced/performance-reviews", windowCode: "route:/workforce/performance" },
  { method: "*", apiPath: "/workforce/advanced/training-courses", windowCode: "route:/workforce/performance" },
  { method: "*", apiPath: "/workforce/advanced/training-enrollments", windowCode: "route:/workforce/performance" },
  { method: "*", apiPath: "/workforce/advanced/manpower-plans", windowCode: "route:/workforce/planning" },
  { method: "*", apiPath: "/workforce/advanced/rosters", windowCode: "route:/workforce/planning" },
  { method: "*", apiPath: "/workforce/advanced/shifts", windowCode: "route:/workforce/planning" },
  { method: "*", apiPath: "/employees/:id", windowCode: "route:/employees/:employeeId" },
  { method: "*", apiPath: "/employees", windowCode: "route:/employees" },
  { method: "*", apiPath: "/placements/:id", windowCode: "route:/employees" },
  { method: "*", apiPath: "/placements", windowCode: "route:/employees" },
  { method: "*", apiPath: "/positions", windowCode: "route:/employees" },

  // --- supply_chain --------------------------------------------------------
  { method: "*", apiPath: "/items", windowCode: "route:/items" },
  { method: "*", apiPath: "/suppliers", windowCode: "route:/suppliers" },
  { method: "*", apiPath: "/purchase-orders", windowCode: "route:/purchasing" },
  { method: "*", apiPath: "/purchase-requests", windowCode: "route:/purchasing" },
  { method: "*", apiPath: "/stock", windowCode: "route:/purchasing" },

  // --- warehouse_management ------------------------------------------------
  // Both prefixes are listed because the application serves both the canonical
  // `/wms` namespace and the legacy `/supply-chain/advanced` one. They are the
  // same Windows: the legacy client routes redirect.
  { method: "*", apiPath: "/wms/warehouses", windowCode: "route:/wms/warehouses" },
  { method: "*", apiPath: "/wms/warehouse-locations", windowCode: "route:/wms/warehouses" },
  { method: "*", apiPath: "/wms/warehouse-tasks", windowCode: "route:/wms/warehouses" },
  { method: "*", apiPath: "/wms/serials", windowCode: "route:/wms/warehouses" },
  { method: "*", apiPath: "/wms/batches", windowCode: "route:/wms/warehouses" },
  { method: "*", apiPath: "/wms/valuation-layers", windowCode: "route:/wms/valuation" },
  { method: "*", apiPath: "/wms/landed-costs", windowCode: "route:/wms/valuation" },
  { method: "*", apiPath: "/wms/accounting-ready-events", windowCode: "route:/wms/valuation" },
  { method: "*", apiPath: "/supply-chain/advanced/warehouses", windowCode: "route:/wms/warehouses" },
  { method: "*", apiPath: "/supply-chain/advanced/warehouse-locations", windowCode: "route:/wms/warehouses" },
  { method: "*", apiPath: "/supply-chain/advanced/warehouse-tasks", windowCode: "route:/wms/warehouses" },
  { method: "*", apiPath: "/supply-chain/advanced/serials", windowCode: "route:/wms/warehouses" },
  { method: "*", apiPath: "/supply-chain/advanced/batches", windowCode: "route:/wms/warehouses" },
  { method: "*", apiPath: "/supply-chain/advanced/valuation-layers", windowCode: "route:/wms/valuation" },
  { method: "*", apiPath: "/supply-chain/advanced/landed-costs", windowCode: "route:/wms/valuation" },
  { method: "*", apiPath: "/supply-chain/advanced/accounting-ready-events", windowCode: "route:/wms/valuation" },
  { method: "*", apiPath: "/supply-chain/advanced", windowCode: "route:/wms/operations" },
  { method: "*", apiPath: "/wms", windowCode: "route:/wms/operations" },

  // --- procurement_management ----------------------------------------------
  { method: "*", apiPath: "/procurement/rfqs", windowCode: "route:/procurement/rfqs" },
  { method: "*", apiPath: "/procurement/bids", windowCode: "route:/procurement/rfqs" },
  { method: "*", apiPath: "/procurement/evaluations", windowCode: "route:/procurement/rfqs" },
  { method: "*", apiPath: "/procurement/contracts", windowCode: "route:/procurement/contracts" },
  { method: "*", apiPath: "/procurement/service-acceptances", windowCode: "route:/procurement/contracts" },
  { method: "*", apiPath: "/procurement/spend-analytics", windowCode: "route:/procurement/spend-analytics" },
  { method: "*", apiPath: "/supply-chain/advanced/rfqs", windowCode: "route:/procurement/rfqs" },
  { method: "*", apiPath: "/supply-chain/advanced/bids", windowCode: "route:/procurement/rfqs" },
  { method: "*", apiPath: "/supply-chain/advanced/evaluations", windowCode: "route:/procurement/rfqs" },
  { method: "*", apiPath: "/supply-chain/advanced/contracts", windowCode: "route:/procurement/contracts" },
  { method: "*", apiPath: "/supply-chain/advanced/service-acceptances", windowCode: "route:/procurement/contracts" },
  { method: "*", apiPath: "/supply-chain/advanced/spend-analytics", windowCode: "route:/procurement/spend-analytics" },

  // --- asset ---------------------------------------------------------------
  // `/assets/schedules` and `/assets/work-orders` are the maintenance Window;
  // `/assets/:id` is the asset detail Window. Longest-pattern-first is what
  // keeps the two apart, and it is the same distinction §4.3's audit drew.
  { method: "*", apiPath: "/asset-movements", windowCode: "route:/assets" },
  { method: "*", apiPath: "/assets/schedules", windowCode: "route:/asset-maintenance" },
  { method: "*", apiPath: "/assets/work-orders", windowCode: "route:/asset-maintenance" },
  { method: "*", apiPath: "/assets/:id", windowCode: "route:/assets/:assetId" },
  { method: "*", apiPath: "/assets", windowCode: "route:/assets" },

  // --- finance -------------------------------------------------------------
  { method: "*", apiPath: "/finance/accounts", windowCode: "route:/finance/accounts" },
  { method: "*", apiPath: "/finance/transactions/:id", windowCode: "route:/finance/transactions/:transactionId" },
  { method: "*", apiPath: "/finance/transactions", windowCode: "route:/finance/transactions" },

  // --- hse -----------------------------------------------------------------
  // `POST /hse/records` is the report form; the `/hse` Window itself is a read
  // surface, so the exact path outranks the module-window prefix.
  { method: "POST", apiPath: "/hse/records", windowCode: "route:/hse/report" },
  { method: "*", apiPath: "/hse/records/:id", windowCode: "route:/hse/records/:recordId" },
  { method: "*", apiPath: "/hse", windowCode: "route:/hse" },

  // --- project_delivery ----------------------------------------------------
  { method: "*", apiPath: "/project-delivery/activities", windowCode: "route:/project-delivery/:projectId" },
  { method: "*", apiPath: "/project-delivery/milestones", windowCode: "route:/project-delivery/:projectId" },
  { method: "*", apiPath: "/project-delivery/projects/:projectId", windowCode: "route:/project-delivery/:projectId" },
  { method: "*", apiPath: "/project-delivery", windowCode: "route:/project-delivery" },

  // --- reporting_insight ---------------------------------------------------
  { method: "*", apiPath: "/reporting", windowCode: "route:/reporting" },

  // --- platform ------------------------------------------------------------
  // Closable like any other module. An administrator who locks their own
  // Role's Window can no longer write through it, which is the decision they
  // recorded — see the header.
  { method: "*", apiPath: "/admin", windowCode: "route:/admin" },
  { method: "*", apiPath: "/app-metadata", windowCode: "route:/administration" },
  // Epic 6 Gelombang 1 — Business Partner canonical party model. Edited from
  // the same `/administration` surface as identity and org structure.
  { method: "*", apiPath: "/business-partners", windowCode: "route:/administration" },
  { method: "*", apiPath: "/config", windowCode: "route:/administration" },
  // Identity, org structure and tenancy are all edited from `/administration`
  // (DashboardPage) and read from `/admin`; `/administration` owns them.
  { method: "*", apiPath: "/legal-entities", windowCode: "route:/administration" },
  { method: "*", apiPath: "/organization-units", windowCode: "route:/administration" },
  // Epic 5 Gelombang 2 — proposing a structure change, reading its
  // effective-dated history and tombstoning a unit are all raised from the same
  // `/administration` organisation surface as the unit list itself. The review
  // queue lives on its own first segment, so it needs its own rule.
  { method: "*", apiPath: "/organization-unit-change-requests", windowCode: "route:/administration" },
  // Epic 5 Gelombang 1 — the Department master is edited from the same
  // `/administration` surface as the rest of the organisation structure.
  { method: "*", apiPath: "/departments", windowCode: "route:/administration" },
  { method: "*", apiPath: "/tenants", windowCode: "route:/admin" },
  { method: "*", apiPath: "/users", windowCode: "route:/administration" },
  { method: "*", apiPath: "/me", windowCode: "route:/profile" },
  // Epic 1 (§4.1 E): switching the session's active Role is authenticated
  // (`app.authenticate` resolves the actor, then the assignment must be one
  // it holds). It is the write behind the "Switch role" control in the user
  // menu, which is part of the profile surface.
  { method: "POST", apiPath: "/auth/switch-role", windowCode: "route:/profile" },

  // Cross-module platform surfaces, each mapped to the page that raises the
  // write. These were the six prefixes step 11b left declared as gaps; only
  // the sub-prefixes that genuinely have a raising page are mapped here, and
  // what is left over is listed in `WINDOW_ENFORCEMENT_EXEMPTIONS` with the
  // property that makes it unmappable.
  //
  // `/notifications/templates` is platform configuration (the same family as
  // `/config` and `/app-metadata`); the recipient's own inbox write is raised
  // from the My Notifications card. `/scheduler/jobs` is the Scheduler card and
  // `/integration/endpoints` the Integration Boundary card, both rendered by
  // `SharedServicesPanel` inside `/administration`.
  { method: "*", apiPath: "/integration/endpoints", windowCode: "route:/administration" },
  { method: "*", apiPath: "/notifications/templates", windowCode: "route:/administration" },
  { method: "*", apiPath: "/notifications/:id/read", windowCode: "route:/administration" },
  { method: "*", apiPath: "/scheduler/jobs", windowCode: "route:/administration" },
  // Workflow splits by who writes. Design-time definitions are a console
  // surface — `AdminWorkflowsView` reads `/admin/workflows` — while every
  // runtime write (raise, claim, act, sweep) is made from `WorkflowPanel`,
  // which renders inside `/administration`.
  { method: "*", apiPath: "/workflow/definitions", windowCode: "route:/admin" },
  { method: "*", apiPath: "/workflow", windowCode: "route:/administration" },
];

/**
 * Mutating routes a Window lock cannot govern, each with the property that makes
 * it ungovernable. §4.4 forbids a silent fallback, so this list is the counted
 * record of the exceptions rather than a licence to skip them.
 *
 * Two properties put a route here, and a route must have one of them to
 * qualify. The coverage test proves it mechanically: each exempt route's own
 * declaration is read, and `unauthenticated` fails the test when the route
 * turns out to carry `app.authenticate` — because such a route DOES have an
 * actor and so could have been mapped.
 *
 *   1. `unauthenticated` — no `preHandler: app.authenticate`, so no actor ever
 *      reaches the plugin and no Role could be consulted. The write is bounded
 *      by a credential the route resolves itself (a JWT at sign-in, an HMAC
 *      signature over the raw body at the webhook receiver).
 *   2. `window-from-request` — the Window is a property of a value in the
 *      request, never of the route pattern. Deriving it server-side still lets
 *      the browser choose the lock, which §4.4 rules out explicitly.
 *
 * Adding one of these routes to `WINDOW_RULES` means deleting it from here, and
 * the test fails in both directions if the two drift.
 */
export interface WindowEnforcementExemption {
  /** Server route pattern, or a segment-aligned prefix of one. */
  apiPath: string;
  /** Which of the two properties above puts this route outside the mapping. */
  property: "unauthenticated" | "window-from-request";
  /** Why no Window in the dictionary corresponds to this route. */
  reason: string;
}

export const WINDOW_ENFORCEMENT_EXEMPTIONS: WindowEnforcementExemption[] = [
  {
    apiPath: "/auth/login",
    property: "unauthenticated",
    reason:
      "Sign-in has no actor, so no Role could be consulted. The credential the route resolves itself (email + password) is what bounds the write.",
  },
  {
    apiPath: "/auth/refresh",
    property: "unauthenticated",
    reason:
      "Refresh carries a rotating token, not a bearer session: there is no actor at decision time. The consumed refresh token is the bound.",
  },
  {
    apiPath: "/auth/logout",
    property: "unauthenticated",
    reason:
      "Gating logout on a Window would make a session unable to end. The refresh token the body names is the bound, and the route revokes exactly it.",
  },
  {
    apiPath: "/documents",
    property: "window-from-request",
    reason:
      "Attachments belong to whatever entity they hang off (`entityType`/`entityId` in the multipart body), across every module. A Window would have to be resolved from that field, which is browser-supplied — §4.4 requires the decision to come from the route, never from what the client sends.",
  },
  {
    apiPath: "/integration/webhook",
    property: "unauthenticated",
    reason:
      "The inbound webhook receiver is called by an external system with no Abixell One session; the HMAC signature over the raw body is its authentication. There is no actor, so no Role and no Window lock.",
  },
];

/**
 * What `RoleDefinition.enforcementStatus` reports.
 *
 * The two values answer different questions, and conflating them is what made
 * the previous derivation unachievable. `"partial"` means the MAPPING has a
 * defect: some mutating route resolves to no Window and carries no exemption.
 * An exemption is not a defect — it is a route no Window could govern, recorded
 * with the property that makes it so and checked against the route's own
 * declaration — so it does not produce `"partial"`.
 *
 * `"enforced"` therefore means: every mutating route the application serves is
 * either governed by the mapping or carries a proven exemption. It does not
 * mean every write is reachable by a Window lock, which would be false.
 *
 * Read through `windowEnforcementStatus()` rather than as a constant: the
 * served-route census only exists once the app has booted.
 */
export type WindowEnforcementStatus = "enforced" | "partial";

/** The segment-aligned exemption claiming `apiPath`, longest pattern first. */
function exemptionFor(apiPath: string): WindowEnforcementExemption | undefined {
  let best: WindowEnforcementExemption | undefined;
  for (const exemption of WINDOW_ENFORCEMENT_EXEMPTIONS) {
    if (
      apiPath !== exemption.apiPath &&
      !apiPath.startsWith(`${exemption.apiPath}/`)
    ) {
      continue;
    }
    if (best === undefined || exemption.apiPath.length > best.apiPath.length) {
      best = exemption;
    }
  }
  return best;
}

/**
 * An exemption is only honoured when the route's own declaration proves it.
 *
 * `unauthenticated` claims there is no actor to consult, so a route that DOES
 * carry `app.authenticate` contradicts it — and such a route could have been
 * mapped, which makes listing it an escape hatch rather than an exemption. The
 * other two properties are properties of the Window's shape, not of the
 * declaration, and cannot be falsified from the route alone; they are reviewed
 * by the route's own guarded write instead.
 */
function exemptionHolds(
  exemption: WindowEnforcementExemption,
  hasActor: boolean,
): boolean {
  if (exemption.property !== "unauthenticated") return true;
  return !hasActor;
}

const ACCOUNTABILITY = {
  governed: new Set<string>(),
  exempt: new Set<string>(),
  unaccounted: new Set<string>(),
};

/**
 * Records one mutating route the application actually serves, and decides
 * whether the mapping accounts for it.
 *
 * Called from the request-path plugin's `onRoute` hook, so the census is the
 * routes Fastify really declared rather than a list maintained beside them.
 * That is what makes `windowEnforcementStatus()` a reading of the server
 * instead of a claim about it — and it is why a route added without a rule
 * flips the status without anyone remembering to update a constant.
 */
export function registerServedMutatingRoute(params: {
  method: string;
  apiPath: string;
  /** True when the route declares `app.authenticate` in its `preHandler`. */
  hasActor: boolean;
}): void {
  const key = `${params.method.toUpperCase()} ${params.apiPath}`;
  if (resolveWindowForApiPath(params.method, params.apiPath) !== undefined) {
    ACCOUNTABILITY.governed.add(key);
    return;
  }
  const exemption = exemptionFor(params.apiPath);
  if (exemption && exemptionHolds(exemption, params.hasActor)) {
    ACCOUNTABILITY.exempt.add(key);
    return;
  }
  ACCOUNTABILITY.unaccounted.add(key);
}

export interface WindowAccountability {
  /** Governed by a `WINDOW_RULES` row, so a lock can reach them. */
  governed: string[];
  /** Outside every rule, with a proven property that makes that necessary. */
  exempt: string[];
  /** Neither. Any entry here is a defect in the mapping. */
  unaccounted: string[];
}

/** The census `registerServedMutatingRoute` accumulated for this process. */
export function windowAccountability(): WindowAccountability {
  return {
    governed: [...ACCOUNTABILITY.governed].sort(),
    exempt: [...ACCOUNTABILITY.exempt].sort(),
    unaccounted: [...ACCOUNTABILITY.unaccounted].sort(),
  };
}

/**
 * `enforced` only once no mutating route is left unaccounted for. Before the
 * app has booted the census is empty, so this reads `enforced` — correct, in
 * the sense that nothing served is unaccounted for, and meaningless as a
 * statement about an app that has not declared its routes yet. Callers that
 * report it to a user run after boot.
 */
export function windowEnforcementStatus(): WindowEnforcementStatus {
  return ACCOUNTABILITY.unaccounted.size === 0 ? "enforced" : "partial";
}

/** True when `rule` governs `apiPath` — exact, or a segment-aligned prefix. */
function ruleMatches(rule: WindowRule, method: string, apiPath: string): boolean {
  if (rule.method !== "*" && rule.method !== method) return false;
  return apiPath === rule.apiPath || apiPath.startsWith(`${rule.apiPath}/`);
}

/**
 * The Window a server route writes through, or `undefined` when no rule claims
 * it. Absence is reported, never guessed: the caller passes it through.
 *
 * Longest pattern wins so `/assets/schedules` beats `/assets`. On an equal
 * length only an exact-method rule and a `*` rule can tie, and the exact one
 * wins — which is what separates `POST /hse/records` (the report form) from
 * `/hse/records/:id` (the record detail).
 */
export function resolveWindowForApiPath(
  method: string,
  apiPath: string,
): string | undefined {
  const normalized = method.toUpperCase();
  let best: WindowRule | undefined;
  for (const rule of WINDOW_RULES) {
    if (!ruleMatches(rule, normalized, apiPath)) continue;
    if (best === undefined) {
      best = rule;
      continue;
    }
    const longer = rule.apiPath.length > best.apiPath.length;
    const sameLengthExact =
      rule.apiPath.length === best.apiPath.length &&
      rule.method !== "*" &&
      best.method === "*";
    if (longer || sameLengthExact) best = rule;
  }
  return best?.windowCode;
}

/**
 * The Window codes this mapping actually covers.
 *
 * A Window is covered when at least one rule names it. Derived from
 * `WINDOW_RULES` rather than declared separately so the two cannot drift, and
 * validated against `ROUTE_REGISTRY` so a typo in a `windowCode` literal
 * surfaces here instead of silently covering nothing.
 */
export function windowsWithEnforcement(): Set<string> {
  const covered = new Set<string>();
  for (const rule of WINDOW_RULES) {
    if (resolveRouteEntry(rule.windowCode.slice(WINDOW_CODE_PREFIX.length))) {
      covered.add(rule.windowCode);
    }
  }
  return covered;
}

/** What the caller's effective assignments say about one Window. */
export interface WindowAccessState {
  /**
   * True when at least one authorization-effective assignment carries a
   * `role_window_access` row for this Window — active or not. Configuring a
   * Role for a Window is what puts it under the lock; a Role nobody has
   * configured is outside it.
   */
  configured: boolean;
  /**
   * True when at least one of those rows has `is_read_write AND is_active`.
   * Union allow: one writable Role the user holds is enough, however many
   * read-only ones they also hold.
   */
  writable: boolean;
}

export interface WindowWriteInput {
  method: string;
  /** Server route pattern as Fastify declares it, e.g. `/wms/warehouses/:id`. */
  path: string;
  /** What the repository read says about the resolved Window. */
  access: WindowAccessState;
}

export interface WindowWriteDecision {
  /** `false` only when a write is rejected by a Window lock. */
  allowed: boolean;
  /** The Window the decision was made about; absent when nothing applied. */
  windowCode?: string;
  /** Present exactly when `allowed` is false. */
  reason?: string;
}

/**
 * Decide whether a request may proceed under the Window read-only rule.
 *
 * Order is fixed and each step is the reason the next one need not run:
 * method → attribution → configuration → writability.
 */
export function evaluateWindowWriteAccess(
  input: WindowWriteInput,
): WindowWriteDecision {
  // Step 1 — §4.4: "tetap dapat membuka Window-nya". Reads pass untouched.
  if (!MUTATING_METHODS.includes(input.method.toUpperCase() as MutatingMethod)) {
    return { allowed: true };
  }

  const windowCode = resolveWindowForApiPath(input.method, input.path);

  // Step 2 — no rule claims this route. §4.4: "Tidak ada fallback diam-diam
  // sebelum pemetaan modul selesai." Passing through is the only choice that
  // does not invent a lock; the coverage test is what keeps the gap counted.
  if (windowCode === undefined) return { allowed: true };

  // Step 3 — nobody configured a Role for this Window, so there is no lock to
  // apply. See the file header: absence is "not configured", never "read-only".
  if (!input.access.configured) return { allowed: true, windowCode };

  // Step 4 — the union allow.
  if (input.access.writable) return { allowed: true, windowCode };

  return {
    allowed: false,
    windowCode,
    reason: WINDOW_READ_ONLY_REASON,
  };
}
