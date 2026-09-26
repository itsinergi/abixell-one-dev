/**
 * Browser-side mirror of the route registry (Epic 2 Wave 1, CORE-ROADMAP.md
 * §4.2 and §4.3). Copied from
 * apps/api/src/domain/configuration/route-registry.ts, which is canonical.
 *
 * The backend registry is canonical; apps/web cannot import apps/api, so the
 * guard reads this mirror instead. Change the backend registry and this file in
 * the same commit — apps/api/tests/route-registry-parity.test.ts fails if the
 * two ever disagree, including on status and permissions.
 *
 * The guard ships in REPORT mode (locked decision, option C): it resolves every
 * route and surfaces what it found, but nothing is blocked yet. Flipping
 * GUARD_ENFORCE to true is NOT by itself a behaviour change — this module only
 * resolves; the shell decides what to do with the answer. Before the flip,
 * AppShell must also branch on the constant (withhold the route rather than
 * warn). Two other things are outstanding for that day: the resolver is
 * case-sensitive while React Router matches case-insensitively, and the guard
 * is a UX affordance only — it hides a page, it never stops an API call. Every
 * operation stays gated by the server's own permission check.
 */

export type RouteRegistrationStatus = "di_menu" | "tersembunyi" | "belum_terdaftar";

/**
 * Report mode. Flip to true only after the report is clean across every route,
 * and only together with the AppShell branch that acts on it. Report mode must
 * never be the state a release ships in on purpose; it exists so the guard can
 * be installed and observed before it can deny anyone.
 */
export const GUARD_ENFORCE = false;

export interface RouteRegistryEntry {
  path: string;
  name: string;
  moduleCode: string;
  status: RouteRegistrationStatus;
  /** "any of" — the route resolves when the user holds at least one. */
  permissions: string[];
  parentPath?: string;
}

/** Every client route, mirrored from the backend registry. */
export const ROUTE_REGISTRY: RouteRegistryEntry[] = [
  {
    path: "/",
    name: "Overview",
    moduleCode: "platform",
    status: "di_menu",
    permissions: [],
  },
  {
    path: "/profile",
    name: "Profile",
    moduleCode: "platform",
    status: "tersembunyi",
    permissions: [],
  },
  {
    path: "/complaints",
    name: "Complaints",
    moduleCode: "customer_complaint",
    status: "di_menu",
    permissions: ["complaint.read", "complaint.manage"],
  },
  {
    path: "/complaints/new",
    name: "Raise a Complaint",
    moduleCode: "customer_complaint",
    status: "tersembunyi",
    permissions: ["complaint.read", "complaint.manage"],
    parentPath: "/complaints",
  },
  {
    path: "/complaints/:complaintId",
    name: "Complaint Detail",
    moduleCode: "customer_complaint",
    status: "tersembunyi",
    permissions: ["complaint.read", "complaint.manage"],
    parentPath: "/complaints",
  },
  {
    path: "/queue",
    name: "Queue",
    moduleCode: "customer_complaint",
    status: "di_menu",
    permissions: ["complaint.read", "complaint.manage"],
  },
  {
    path: "/queue/:complaintId",
    name: "Queue Item",
    moduleCode: "customer_complaint",
    status: "tersembunyi",
    permissions: ["complaint.read", "complaint.manage"],
    parentPath: "/queue",
  },
  {
    path: "/verification",
    name: "Verification",
    moduleCode: "customer_complaint",
    status: "di_menu",
    permissions: ["workflow.instance.manage"],
  },
  {
    path: "/verification/:complaintId",
    name: "Verification Detail",
    moduleCode: "customer_complaint",
    status: "tersembunyi",
    permissions: ["workflow.instance.manage"],
    parentPath: "/verification",
  },
  {
    path: "/management",
    name: "Management Dashboard",
    moduleCode: "customer_complaint",
    status: "di_menu",
    permissions: ["complaint.dashboard.read"],
  },
  {
    path: "/service-quality",
    name: "Service Quality",
    moduleCode: "customer_complaint",
    status: "di_menu",
    permissions: ["service_quality.read", "service_quality.configure"],
  },
  {
    path: "/administration/complaints",
    name: "Complaint Configuration",
    moduleCode: "customer_complaint",
    status: "tersembunyi",
    permissions: ["complaint.configure"],
  },
  {
    path: "/surveys",
    name: "Surveys",
    moduleCode: "survey_assessment",
    status: "di_menu",
    permissions: ["survey.manage", "survey.analytics.read"],
  },
  {
    path: "/surveys/:code",
    name: "Survey Detail",
    moduleCode: "survey_assessment",
    status: "tersembunyi",
    permissions: ["survey.manage", "survey.analytics.read"],
    parentPath: "/surveys",
  },
  {
    path: "/my-surveys",
    name: "My Surveys",
    moduleCode: "survey_assessment",
    status: "di_menu",
    permissions: ["survey.respond"],
  },
  {
    path: "/my-surveys/:assignmentId",
    name: "Survey Response",
    moduleCode: "survey_assessment",
    status: "tersembunyi",
    permissions: ["survey.respond"],
    parentPath: "/my-surveys",
  },
  {
    path: "/work-orders",
    name: "Work Orders",
    moduleCode: "service_operations",
    status: "di_menu",
    permissions: ["service_operations.manage", "service_operations.read"],
  },
  {
    path: "/work-orders/:workOrderId",
    name: "Work Order Detail",
    moduleCode: "service_operations",
    status: "tersembunyi",
    permissions: ["service_operations.manage", "service_operations.read"],
    parentPath: "/work-orders",
  },
  {
    path: "/my-work",
    name: "My Work",
    moduleCode: "service_operations",
    status: "di_menu",
    permissions: ["service_operations.execute"],
  },
  {
    path: "/my-work/:workOrderId",
    name: "My Work Detail",
    moduleCode: "service_operations",
    status: "tersembunyi",
    permissions: ["service_operations.execute"],
    parentPath: "/my-work",
  },
  {
    path: "/service-types",
    name: "Service Types",
    moduleCode: "service_operations",
    status: "di_menu",
    permissions: ["service_operations.configure"],
  },
  {
    path: "/service-packs",
    name: "Service Packs",
    moduleCode: "service_operations",
    status: "di_menu",
    permissions: ["service_operations.pack.manage"],
  },
  {
    path: "/service-optimization",
    name: "Service Optimization",
    moduleCode: "service_operations",
    status: "di_menu",
    permissions: ["service_operations.optimization.read", "service_operations.optimization.apply"],
  },
  {
    path: "/service-optimization/:runId",
    name: "Optimization Run Detail",
    moduleCode: "service_operations",
    status: "tersembunyi",
    permissions: ["service_operations.optimization.read", "service_operations.optimization.apply"],
    parentPath: "/service-optimization",
  },
  {
    path: "/customer-commercial",
    name: "Customers",
    moduleCode: "customer_commercial",
    status: "di_menu",
    permissions: ["customer.read"],
  },
  {
    path: "/sales",
    name: "Sales & Pipeline",
    moduleCode: "customer_commercial",
    status: "di_menu",
    permissions: ["sales.read", "sales.manage"],
  },
  {
    path: "/employees",
    name: "Employees",
    moduleCode: "workforce",
    status: "di_menu",
    permissions: ["workforce.read", "workforce.manage"],
  },
  {
    path: "/employees/:employeeId",
    name: "Employee Detail",
    moduleCode: "workforce",
    status: "tersembunyi",
    permissions: ["workforce.read", "workforce.manage"],
    parentPath: "/employees",
  },
  {
    path: "/workforce/attendance",
    name: "Attendance & Rosters",
    moduleCode: "workforce",
    status: "di_menu",
    permissions: ["workforce.attendance.read", "workforce.attendance.manage"],
  },
  {
    path: "/workforce/leave-overtime",
    name: "Leave & Overtime",
    moduleCode: "workforce",
    status: "di_menu",
    permissions: ["workforce.leave.read", "workforce.leave.manage", "workforce.leave.approve"],
  },
  {
    path: "/workforce/payroll",
    name: "Payroll",
    moduleCode: "workforce",
    status: "di_menu",
    permissions: ["workforce.payroll.read", "workforce.payroll.manage", "workforce.payroll.approve"],
  },
  {
    path: "/workforce/recruitment",
    name: "Recruitment",
    moduleCode: "workforce",
    status: "di_menu",
    permissions: ["workforce.recruitment.read", "workforce.recruitment.manage"],
  },
  {
    path: "/workforce/performance",
    name: "Talent & Performance",
    moduleCode: "workforce",
    status: "di_menu",
    permissions: ["workforce.performance.read", "workforce.performance.manage"],
  },
  {
    path: "/workforce/planning",
    name: "Workforce Planning",
    moduleCode: "workforce",
    status: "di_menu",
    permissions: ["workforce.planning.read", "workforce.planning.manage", "workforce.planning.apply"],
  },
  {
    path: "/items",
    name: "Items & Stock",
    moduleCode: "supply_chain",
    status: "di_menu",
    permissions: ["supply_chain.read"],
  },
  {
    path: "/suppliers",
    name: "Suppliers",
    moduleCode: "supply_chain",
    status: "di_menu",
    permissions: ["supply_chain.read"],
  },
  {
    path: "/purchasing",
    name: "Purchasing",
    moduleCode: "supply_chain",
    status: "di_menu",
    permissions: ["supply_chain.manage", "supply_chain.stock.manage"],
  },
  {
    path: "/wms/warehouses",
    name: "Warehouses & Tracking",
    moduleCode: "warehouse_management",
    status: "di_menu",
    permissions: ["supply_chain.warehouse.read", "supply_chain.warehouse.manage"],
  },
  {
    path: "/wms/operations",
    name: "Stock Operations",
    moduleCode: "warehouse_management",
    status: "di_menu",
    permissions: ["supply_chain.inventory.read", "supply_chain.inventory.manage", "supply_chain.inventory.approve"],
  },
  {
    path: "/wms/valuation",
    name: "Valuation & Landed Cost",
    moduleCode: "warehouse_management",
    status: "di_menu",
    permissions: ["supply_chain.valuation.read", "supply_chain.valuation.manage"],
  },
  {
    path: "/supply-chain/warehouses",
    name: "Warehouses (legacy path)",
    moduleCode: "warehouse_management",
    status: "tersembunyi",
    permissions: ["supply_chain.warehouse.read", "supply_chain.warehouse.manage"],
  },
  {
    path: "/supply-chain/operations",
    name: "Stock Operations (legacy path)",
    moduleCode: "warehouse_management",
    status: "tersembunyi",
    permissions: ["supply_chain.inventory.read", "supply_chain.inventory.manage", "supply_chain.inventory.approve"],
  },
  {
    path: "/supply-chain/valuation",
    name: "Valuation (legacy path)",
    moduleCode: "warehouse_management",
    status: "tersembunyi",
    permissions: ["supply_chain.valuation.read", "supply_chain.valuation.manage"],
  },
  {
    path: "/procurement/rfqs",
    name: "RFQ & Tendering",
    moduleCode: "procurement_management",
    status: "di_menu",
    permissions: ["supply_chain.procurement.read", "supply_chain.procurement.manage", "supply_chain.procurement.award"],
  },
  {
    path: "/procurement/contracts",
    name: "Supplier Contracts & Scorecards",
    moduleCode: "procurement_management",
    status: "di_menu",
    permissions: ["supply_chain.contract.read", "supply_chain.contract.manage", "supply_chain.contract.approve"],
  },
  {
    path: "/procurement/spend-analytics",
    name: "Spend Analytics",
    moduleCode: "procurement_management",
    status: "di_menu",
    permissions: ["supply_chain.analytics.read"],
  },
  {
    path: "/supply-chain/procurement",
    name: "RFQ (legacy path)",
    moduleCode: "procurement_management",
    status: "tersembunyi",
    permissions: ["supply_chain.procurement.read", "supply_chain.procurement.manage", "supply_chain.procurement.award"],
  },
  {
    path: "/supply-chain/contracts",
    name: "Contracts (legacy path)",
    moduleCode: "procurement_management",
    status: "tersembunyi",
    permissions: ["supply_chain.contract.read", "supply_chain.contract.manage", "supply_chain.contract.approve"],
  },
  {
    path: "/supply-chain/spend-analytics",
    name: "Spend Analytics (legacy path)",
    moduleCode: "procurement_management",
    status: "tersembunyi",
    permissions: ["supply_chain.analytics.read"],
  },
  {
    path: "/assets",
    name: "Assets",
    moduleCode: "asset",
    status: "di_menu",
    permissions: ["asset.read", "asset.manage", "asset.move"],
  },
  {
    path: "/assets/:assetId",
    name: "Asset Detail",
    moduleCode: "asset",
    status: "tersembunyi",
    permissions: ["asset.read", "asset.manage", "asset.move"],
    parentPath: "/assets",
  },
  {
    path: "/asset-maintenance",
    name: "Asset Maintenance",
    moduleCode: "asset",
    status: "di_menu",
    permissions: ["asset.maintenance.read", "asset.maintenance.manage"],
  },
  {
    path: "/asset-maintenance/work-orders/:workOrderId",
    name: "Maintenance Work Order Detail",
    moduleCode: "asset",
    status: "tersembunyi",
    permissions: ["asset.maintenance.read", "asset.maintenance.manage"],
    parentPath: "/asset-maintenance",
  },
  {
    path: "/asset-maintenance/assets/:assetId",
    name: "Asset Performance",
    moduleCode: "asset",
    status: "tersembunyi",
    permissions: ["asset.meter.manage", "asset.downtime.manage", "asset.analytics.read"],
    parentPath: "/asset-maintenance",
  },
  {
    path: "/finance/accounts",
    name: "Cash & Bank",
    moduleCode: "finance",
    status: "di_menu",
    permissions: ["finance.configure", "finance.read"],
  },
  {
    path: "/finance/transactions",
    name: "Transactions",
    moduleCode: "finance",
    status: "di_menu",
    permissions: ["finance.read", "finance.manage"],
  },
  {
    path: "/finance/transactions/:transactionId",
    name: "Transaction Detail",
    moduleCode: "finance",
    status: "tersembunyi",
    permissions: ["finance.read", "finance.manage"],
    parentPath: "/finance/transactions",
  },
  {
    path: "/finance/cashflow",
    name: "Cashflow",
    moduleCode: "finance",
    status: "di_menu",
    permissions: ["finance.read"],
  },
  {
    path: "/hse",
    name: "HSE",
    moduleCode: "hse",
    status: "di_menu",
    permissions: ["hse.read"],
  },
  {
    path: "/hse/report",
    name: "Report an Incident",
    moduleCode: "hse",
    status: "tersembunyi",
    permissions: ["hse.report", "hse.manage"],
    parentPath: "/hse",
  },
  {
    path: "/hse/records/:recordId",
    name: "HSE Record Detail",
    moduleCode: "hse",
    status: "tersembunyi",
    permissions: ["hse.read"],
    parentPath: "/hse",
  },
  {
    path: "/project-delivery",
    name: "Project Delivery",
    moduleCode: "project_delivery",
    status: "di_menu",
    permissions: ["project_delivery.read", "project_delivery.manage"],
  },
  {
    path: "/project-delivery/:projectId",
    name: "Project Detail",
    moduleCode: "project_delivery",
    status: "tersembunyi",
    permissions: ["project_delivery.read", "project_delivery.manage"],
    parentPath: "/project-delivery",
  },
  {
    path: "/reporting",
    name: "Reporting",
    moduleCode: "reporting_insight",
    status: "di_menu",
    permissions: ["reporting.read", "reporting.bi.manage", "reporting.predictive.read"],
  },
  {
    path: "/administration",
    name: "Administration",
    moduleCode: "platform",
    status: "di_menu",
    permissions: ["config.manage"],
  },
  {
    path: "/admin",
    name: "Admin Console",
    moduleCode: "platform",
    status: "di_menu",
    permissions: ["admin.console.read"],
  },
  {
    path: "/login",
    name: "Sign In",
    moduleCode: "platform",
    status: "tersembunyi",
    permissions: [],
  },
  {
    path: "/select-workspace",
    name: "Select Workspace",
    moduleCode: "platform",
    status: "tersembunyi",
    permissions: [],
  },
  {
    path: "/public/surveys/:token",
    name: "Public Survey Response",
    moduleCode: "survey_assessment",
    status: "tersembunyi",
    permissions: [],
  },
  {
    path: "*",
    name: "Not Found (redirect to Overview)",
    moduleCode: "platform",
    status: "tersembunyi",
    permissions: [],
  },
];

/** Trailing slashes are equivalent: `/complaints/` is `/complaints`. */
function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.replace(/\/+$/, "");
  return path;
}

/**
 * The route entry matching a pathname, or `null` when no route in App.tsx
 * corresponds to it. `:param` matches exactly one segment. The wildcard `*`
 * is deliberately not a fallback: if it matched, no path could ever resolve to
 * `belum_terdaftar`, and reporting those is the point of report mode.
 */
export function resolveRouteEntry(pathname: string): RouteRegistryEntry | null {
  const normalized = normalizePath(pathname);
  const exact = ROUTE_REGISTRY.find((r) => r.path === normalized);
  if (exact) return exact;

  const requestParts = normalized.split("/");
  return (
    ROUTE_REGISTRY.find((route) => {
      if (route.path === "*") return false;
      const routeParts = route.path.split("/");
      if (routeParts.length !== requestParts.length) return false;
      return routeParts.every(
        (part, index) => part.startsWith(":") || part === requestParts[index],
      );
    }) ?? null
  );
}

export interface RouteGuardReport {
  pathname: string;
  /** `false` when the path is unknown to the registry (`belum_terdaftar`). */
  registered: boolean;
  entry: RouteRegistryEntry | null;
  /** Permission codes the route requires and the user does not hold. */
  missingPermissions: string[];
  /** `true` when the route resolves and the user may reach it. */
  ok: boolean;
}

/**
 * Resolve a pathname against the registry and the user's granted permissions.
 * Pure and total: it reports, it does not decide. GUARD_ENFORCE decides.
 */
export function evaluateRouteAccess(
  pathname: string,
  grantedPermissions: readonly string[],
): RouteGuardReport {
  const entry = resolveRouteEntry(pathname);
  if (!entry) {
    return {
      pathname,
      registered: false,
      entry: null,
      missingPermissions: [],
      ok: false,
    };
  }
  const granted = new Set(grantedPermissions);
  const absent = entry.permissions.filter((code) => !granted.has(code));
  // "any of": the route resolves with at least one of its codes, so it is only
  // withheld when the user holds none of them.
  const missingPermissions =
    entry.permissions.length > 0 && absent.length === entry.permissions.length ? absent : [];
  return {
    pathname,
    registered: true,
    entry,
    missingPermissions,
    ok: missingPermissions.length === 0,
  };
}
