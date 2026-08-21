/**
 * Checkpoint 1C.1 — Experience-layer capability & navigation model.
 *
 * Single, client-neutral source of truth for the persona navigation. It
 * maps the raw permission codes returned by `GET /me` to the sections a
 * user may SEE. This is a UX convenience only — every backend route
 * re-enforces its own authorization (RBAC + Customer/Organization/Tenant
 * Data Scope). Hiding a nav item never grants or denies access; it only
 * declutters the shell for the persona in front of it.
 *
 * Deliberately NOT hardcoded per client: sections are gated by generic
 * capability, so the exact same build renders the right menu for a
 * Customer User, a Complaint Handler, a Verifier, Management, or an
 * Administrator purely from that user's granted permissions.
 *
 * Naming rule (ADR-0003): every user-facing `label` here is client-neutral
 * product language — no internal "whitelabel / shared core / platform"
 * terminology ever reaches this layer.
 */

/** Permission codes this layer references. These already exist in the
 * Core RBAC catalog (Phase 0 / Checkpoint 1B seed) — 1C.1 adds none.
 *
 * Note (FD-1C-02): the finer-grained `complaint.dashboard.read` and
 * `complaint.configure` permissions are APPROVED but intentionally NOT
 * wired here yet — they gate real functionality that lands in 1C.5
 * (Management Dashboard) and 1C.6 (Admin Configuration). Until then the
 * Management section is gated on the existing `workflow.instance.manage`
 * capability as a conservative proxy, and Administration on the existing
 * `config.manage`. This keeps 1C.1 a pure frontend foundation with zero
 * backend/permission changes; the swap is a one-line change in each
 * `requiresAnyOf` when those permissions are introduced. */
export const PERMISSIONS = {
  complaintRead: "complaint.read",
  complaintManage: "complaint.manage",
  workflowManage: "workflow.instance.manage",
  complaintDashboardRead: "complaint.dashboard.read",
  complaintConfigure: "complaint.configure",
  configManage: "config.manage",
  surveyManage: "survey.manage",
  surveyRespond: "survey.respond",
  serviceOperationsRead: "service_operations.read",
  serviceOperationsManage: "service_operations.manage",
  serviceOperationsExecute: "service_operations.execute",
  serviceOperationsConfigure: "service_operations.configure",
  workforceRead: "workforce.read",
  workforceManage: "workforce.manage",
  supplyChainRead: "supply_chain.read",
  supplyChainManage: "supply_chain.manage",
  supplyChainStockManage: "supply_chain.stock.manage",
  supplyChainConfigure: "supply_chain.configure",
  assetRead: "asset.read",
  assetManage: "asset.manage",
  assetMove: "asset.move",
  financeRead: "finance.read",
  financeManage: "finance.manage",
  financeApprove: "finance.approve",
  financeConfigure: "finance.configure",
  projectDeliveryRead: "project_delivery.read",
  projectDeliveryManage: "project_delivery.manage",
} as const;

export interface NavSection {
  /** Stable key, also used for testing hooks. */
  key: string;
  /** Route path relative to the shell root. */
  path: string;
  /** Client-neutral, user-facing label. */
  label: string;
  /** Short description shown on the Overview cards. */
  description: string;
  /** Visible if the user holds AT LEAST ONE of these permissions.
   * `undefined` means "visible to any authenticated user". */
  requiresAnyOf?: string[];
  /** Visible only to INTERNAL users — those with an organization_unit or
   * tenant Data Scope (Checkpoint 1C.3). Keeps operational areas away from
   * external Customer Users. UX only; the backend still enforces access. */
  requiresInternal?: boolean;
  /** Visible only to users who hold a customer Data Scope (external Customer
   * Users) — the customer-facing complaint experience. */
  requiresCustomerScope?: boolean;
}

/** Internal = holds any non-customer Data Scope (organization_unit/tenant). */
export function isInternalScope(scopeTypes: string[]): boolean {
  return scopeTypes.some((s) => s !== "customer");
}

export function hasCustomerScope(scopeTypes: string[]): boolean {
  return scopeTypes.includes("customer");
}

/**
 * Persona experience areas prepared by 1C.1. The pages behind
 * Complaints / Verification / Management are foundation placeholders in
 * 1C.1 and are filled in by later, separately-gated checkpoints
 * (1C.2–1C.6). Administration mounts the existing Phase 0 admin surface.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    key: "overview",
    path: "/",
    label: "Overview",
    description: "Your workspace at a glance.",
  },
  {
    key: "complaints",
    path: "/complaints",
    label: "Complaints",
    description: "Raise and track the complaints you have submitted.",
    requiresAnyOf: [PERMISSIONS.complaintRead, PERMISSIONS.complaintManage],
    requiresCustomerScope: true,
  },
  {
    key: "queue",
    path: "/queue",
    label: "Queue",
    description: "Work the complaints assigned to you and your team.",
    requiresAnyOf: [PERMISSIONS.complaintRead, PERMISSIONS.complaintManage],
    requiresInternal: true,
  },
  {
    key: "verification",
    path: "/verification",
    label: "Verification",
    description: "Independently verify corrective actions awaiting sign-off.",
    // QA/verification is an internal area — gate it away from Customer Users
    // (who hold complaint.manage on their own complaints). `workflow.instance.manage`
    // is the closest existing capability the verifier persona holds
    // (COMPLAINT_MANAGER); it will be replaced by a dedicated permission
    // when 1C.4 / FD-1C-02 land. Backend still enforces all authorization.
    requiresAnyOf: [PERMISSIONS.workflowManage],
  },
  {
    key: "management",
    path: "/management",
    label: "Management",
    description: "Complaint performance, SLA, and escalation visibility.",
    // FD-1C-02: gated on the real management permission now (replacing the
    // 1C.1 workflow.instance.manage proxy). Backend enforces it too.
    requiresAnyOf: [PERMISSIONS.complaintDashboardRead],
  },
  {
    key: "my-surveys",
    path: "/my-surveys",
    label: "My Surveys",
    description: "Surveys assigned to you — respond and submit.",
    requiresAnyOf: [PERMISSIONS.surveyRespond],
  },
  {
    key: "surveys",
    path: "/surveys",
    label: "Surveys",
    description: "Author survey definitions, publish versions, and assign them.",
    requiresAnyOf: [PERMISSIONS.surveyManage],
  },
  {
    key: "my-work",
    path: "/my-work",
    label: "My Work",
    description: "The jobs assigned to you — record what you did in the field.",
    requiresAnyOf: [PERMISSIONS.serviceOperationsExecute],
  },
  {
    key: "work-orders",
    path: "/work-orders",
    label: "Work Orders",
    description: "Plan, assign, and follow the work your teams are delivering.",
    requiresAnyOf: [PERMISSIONS.serviceOperationsManage, PERMISSIONS.serviceOperationsRead],
    requiresInternal: true,
  },
  {
    key: "service-types",
    path: "/service-types",
    label: "Service Types",
    description: "Define the reusable services your teams deliver.",
    requiresAnyOf: [PERMISSIONS.serviceOperationsConfigure],
  },
  {
    key: "employees",
    path: "/employees",
    label: "Employees",
    description: "Who works here, and where they belong in the organisation.",
    requiresAnyOf: [PERMISSIONS.workforceRead, PERMISSIONS.workforceManage],
    requiresInternal: true,
  },
  {
    key: "items",
    path: "/items",
    label: "Items & Stock",
    description: "What exists, how much of it, and what moved.",
    requiresAnyOf: [PERMISSIONS.supplyChainRead],
    requiresInternal: true,
  },
  {
    key: "suppliers",
    path: "/suppliers",
    label: "Suppliers",
    description: "Who you buy from.",
    requiresAnyOf: [PERMISSIONS.supplyChainRead],
    requiresInternal: true,
  },
  {
    key: "purchasing",
    path: "/purchasing",
    label: "Purchasing",
    description: "Request, order, and receive what your teams need.",
    requiresAnyOf: [PERMISSIONS.supplyChainManage, PERMISSIONS.supplyChainStockManage],
    requiresInternal: true,
  },
  {
    key: "assets",
    path: "/assets",
    label: "Assets",
    description: "What you own, where it is, and who holds it.",
    requiresAnyOf: [PERMISSIONS.assetRead, PERMISSIONS.assetManage, PERMISSIONS.assetMove],
    requiresInternal: true,
  },
  {
    key: "finance-transactions",
    path: "/finance/transactions",
    label: "Transactions",
    description: "What came in, what went out, and what it was for.",
    requiresAnyOf: [PERMISSIONS.financeRead, PERMISSIONS.financeManage],
    requiresInternal: true,
  },
  {
    key: "finance-cashflow",
    path: "/finance/cashflow",
    label: "Cashflow",
    description: "What moved this period, and where you stand now.",
    requiresAnyOf: [PERMISSIONS.financeRead],
    requiresInternal: true,
  },
  {
    key: "finance-accounts",
    path: "/finance/accounts",
    label: "Cash & Bank",
    description: "Where the money actually sits.",
    requiresAnyOf: [PERMISSIONS.financeConfigure, PERMISSIONS.financeRead],
    requiresInternal: true,
  },
  {
    key: "project-delivery",
    path: "/project-delivery",
    label: "Project Delivery",
    description: "Track project activities, milestones, and delivery progress.",
    requiresAnyOf: [PERMISSIONS.projectDeliveryRead, PERMISSIONS.projectDeliveryManage],
    requiresInternal: true,
  },
  {
    key: "administration",
    path: "/administration",
    label: "Administration",
    description: "Organization, users, configuration, and shared services.",
    requiresAnyOf: [PERMISSIONS.configManage],
  },
];

/** True if the user (permissions + scope types) satisfies the section's gate. */
export function canSeeSection(
  section: NavSection,
  permissions: string[],
  scopeTypes: string[],
): boolean {
  if (section.requiresAnyOf && !section.requiresAnyOf.some((p) => permissions.includes(p))) {
    return false;
  }
  if (section.requiresInternal && !isInternalScope(scopeTypes)) return false;
  if (section.requiresCustomerScope && !hasCustomerScope(scopeTypes)) return false;
  return true;
}

/** The sections a user may see, in nav order. */
export function visibleSections(permissions: string[], scopeTypes: string[]): NavSection[] {
  return NAV_SECTIONS.filter((s) => canSeeSection(s, permissions, scopeTypes));
}
