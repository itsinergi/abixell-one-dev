import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AppShell } from "./shell/layout/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { OverviewPage } from "./pages/OverviewPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ComplaintsListPage } from "./pages/complaints/ComplaintsListPage";
import { ComplaintCreatePage } from "./pages/complaints/ComplaintCreatePage";
import { ComplaintDetailPage } from "./pages/complaints/ComplaintDetailPage";
import { OperationalQueuePage } from "./pages/operational/OperationalQueuePage";
import { OperationalDetailPage } from "./pages/operational/OperationalDetailPage";
import { VerificationQueuePage } from "./pages/verification/VerificationQueuePage";
import { VerificationDetailPage } from "./pages/verification/VerificationDetailPage";
import { ManagementDashboardPage } from "./pages/management/ManagementDashboardPage";
import { ComplaintConfigPage } from "./pages/admin/ComplaintConfigPage";
import { SurveyListPage } from "./pages/survey/SurveyListPage";
import { SurveyDetailPage } from "./pages/survey/SurveyDetailPage";
import { MySurveysPage } from "./pages/survey/MySurveysPage";
import { MySurveyDetailPage } from "./pages/survey/MySurveyDetailPage";
import { PublicSurveyPage } from "./pages/survey/PublicSurveyPage";
import { WorkOrderQueuePage } from "./modules/service-operations/WorkOrderQueuePage";
import { WorkOrderDetailPage } from "./modules/service-operations/WorkOrderDetailPage";
import { MyWorkPage } from "./modules/service-operations/MyWorkPage";
import { MyWorkDetailPage } from "./modules/service-operations/MyWorkDetailPage";
import { ServiceDefinitionsPage } from "./modules/service-operations/ServiceDefinitionsPage";
import { CustomerCommercialPage } from "./modules/customer-commercial/CustomerCommercialPage";
import { SalesPipelinePage } from "./pages/sales/SalesPipelinePage";
import { ServiceQualityPage } from "./pages/service-quality/ServiceQualityPage";
import { EmployeesPage } from "./modules/workforce/EmployeesPage";
import { EmployeeDetailPage } from "./modules/workforce/EmployeeDetailPage";
import { WorkforceAttendancePage } from "./pages/workforce-advanced/WorkforceAttendancePage";
import { WorkforceLeaveOvertimePage } from "./pages/workforce-advanced/WorkforceLeaveOvertimePage";
import { WorkforcePayrollPage } from "./pages/workforce-advanced/WorkforcePayrollPage";
import { WorkforceRecruitmentPage } from "./pages/workforce-advanced/WorkforceRecruitmentPage";
import { WorkforcePerformancePage } from "./pages/workforce-advanced/WorkforcePerformancePage";
import { WorkforcePlanningPage } from "./pages/workforce-advanced/WorkforcePlanningPage";
import { ItemsPage } from "./modules/supply-chain/ItemsPage";
import { SuppliersPage } from "./modules/supply-chain/SuppliersPage";
import { PurchasingPage } from "./modules/supply-chain/PurchasingPage";
import { WarehousesPage, StockOperationsPage, ValuationPage } from "./pages/wms";
import { ProcurementPage, SupplierContractsPage, SpendAnalyticsPage } from "./pages/procurement";
import { AssetsPage } from "./modules/asset/AssetsPage";
import { AssetDetailPage } from "./modules/asset/AssetDetailPage";
import { ServicePacksPage } from "./pages/service-operations/ServicePacksPage";
import { ServiceOptimizationPage } from "./pages/service-operations/ServiceOptimizationPage";
import { ServiceOptimizationDetailPage } from "./pages/service-operations/ServiceOptimizationDetailPage";
import { AssetMaintenancePage } from "./pages/asset-advanced/AssetMaintenancePage";
import { AssetMaintenanceWorkOrderDetailPage } from "./pages/asset-advanced/AssetMaintenanceWorkOrderDetailPage";
import { AssetPerformancePage } from "./pages/asset-advanced/AssetPerformancePage";
import { FinanceAccountsPage } from "./modules/finance/FinanceAccountsPage";
import { FinanceTransactionsPage } from "./modules/finance/FinanceTransactionsPage";
import { FinanceTransactionDetailPage } from "./modules/finance/FinanceTransactionDetailPage";
import { CashflowPage } from "./modules/finance/CashflowPage";
import { HseRegisterPage } from "./modules/hse/HseRegisterPage";
import { HseReportPage } from "./modules/hse/HseReportPage";
import { HseDetailPage } from "./modules/hse/HseDetailPage";
import { ProjectDeliveryPage } from "./modules/project-delivery/ProjectDeliveryPage";
import { ProjectDeliveryDetailPage } from "./modules/project-delivery/ProjectDeliveryDetailPage";
import { ReportingInsightPage } from "./modules/reporting-insight/ReportingInsightPage";
import { AdminConsolePage } from "./pages/admin/console/AdminConsolePage";
import { useAuth } from "./auth/AuthContext";

/**
 * Route protection as a layout route: waits for AuthProvider to finish
 * validating/refreshing a persisted session before deciding to redirect
 * (Checkpoint 0F) — otherwise a returning user with a valid session would
 * flash through /login on every reload. Nested routes render via <Outlet/>.
 */
function ProtectedLayout() {
  const { session, initializing } = useAuth();
  if (initializing) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Loading…
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}

/**
 * Checkpoint 1C.1 — multi-route experience layer. The shell is a layout
 * route; each persona section is a child route, gated for visibility by
 * the navigation capability model (backend still enforces authorization).
 * Section experiences behind Complaints / Verification / Management arrive
 * in later checkpoints; Administration mounts the existing Phase 0 surface.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Wave A2 / SUR-ADV-005 — token-governed public route, intentionally
          outside authentication and the internal workspace shell. */}
      <Route path="/public/surveys/:token" element={<PublicSurveyPage />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="complaints" element={<ComplaintsListPage />} />
          <Route path="complaints/new" element={<ComplaintCreatePage />} />
          <Route path="complaints/:complaintId" element={<ComplaintDetailPage />} />
          <Route path="queue" element={<OperationalQueuePage />} />
          <Route path="queue/:complaintId" element={<OperationalDetailPage />} />
          <Route path="verification" element={<VerificationQueuePage />} />
          <Route path="verification/:complaintId" element={<VerificationDetailPage />} />
          <Route path="management" element={<ManagementDashboardPage />} />
          <Route path="administration" element={<DashboardPage />} />
          <Route path="administration/complaints" element={<ComplaintConfigPage />} />
          <Route path="surveys" element={<SurveyListPage />} />
          <Route path="surveys/:code" element={<SurveyDetailPage />} />
          <Route path="my-surveys" element={<MySurveysPage />} />
          <Route path="my-surveys/:assignmentId" element={<MySurveyDetailPage />} />
          {/* Phase 2 — Service Operations & Work Management */}
          <Route path="work-orders" element={<WorkOrderQueuePage />} />
          <Route path="work-orders/:workOrderId" element={<WorkOrderDetailPage />} />
          <Route path="my-work" element={<MyWorkPage />} />
          <Route path="my-work/:workOrderId" element={<MyWorkDetailPage />} />
          <Route path="service-types" element={<ServiceDefinitionsPage />} />
          {/* Wave A3 — Vertical Packs and Service Operations optimization */}
          <Route path="service-packs" element={<ServicePacksPage />} />
          <Route path="service-optimization" element={<ServiceOptimizationPage />} />
          <Route path="service-optimization/:runId" element={<ServiceOptimizationDetailPage />} />
          {/* Phase 10 — Customer & Commercial completion */}
          <Route path="customer-commercial" element={<CustomerCommercialPage />} />
          {/* Wave A1 — Sales & Pipeline */}
          <Route path="sales" element={<SalesPipelinePage />} />
          {/* Wave A1 — Service Quality Advanced */}
          <Route path="service-quality" element={<ServiceQualityPage />} />
          {/* Phase 3 — Workforce / HR */}
          <Route path="employees" element={<EmployeesPage />} />
          <Route path="employees/:employeeId" element={<EmployeeDetailPage />} />
          {/* Wave A4 — Workforce Advanced */}
          <Route path="workforce/attendance" element={<WorkforceAttendancePage />} />
          <Route path="workforce/leave-overtime" element={<WorkforceLeaveOvertimePage />} />
          <Route path="workforce/payroll" element={<WorkforcePayrollPage />} />
          <Route path="workforce/recruitment" element={<WorkforceRecruitmentPage />} />
          <Route path="workforce/performance" element={<WorkforcePerformancePage />} />
          <Route path="workforce/planning" element={<WorkforcePlanningPage />} />
          {/* Phase 4 — Supply Chain */}
          <Route path="items" element={<ItemsPage />} />
          <Route path="suppliers" element={<SuppliersPage />} />
          <Route path="purchasing" element={<PurchasingPage />} />
          {/* Wave A5 — Supply Chain Advanced (decomposed bounded contexts) */}
          <Route path="wms/warehouses" element={<WarehousesPage />} />
          <Route path="wms/operations" element={<StockOperationsPage />} />
          <Route path="wms/valuation" element={<ValuationPage />} />
          <Route path="procurement/rfqs" element={<ProcurementPage />} />
          <Route path="procurement/contracts" element={<SupplierContractsPage />} />
          <Route path="procurement/spend-analytics" element={<SpendAnalyticsPage />} />
          {/* Backward-compatibility redirects for legacy deep links */}
          <Route path="supply-chain/warehouses" element={<Navigate to="/wms/warehouses" replace />} />
          <Route path="supply-chain/operations" element={<Navigate to="/wms/operations" replace />} />
          <Route path="supply-chain/valuation" element={<Navigate to="/wms/valuation" replace />} />
          <Route path="supply-chain/procurement" element={<Navigate to="/procurement/rfqs" replace />} />
          <Route path="supply-chain/contracts" element={<Navigate to="/procurement/contracts" replace />} />
          <Route path="supply-chain/spend-analytics" element={<Navigate to="/procurement/spend-analytics" replace />} />
          {/* Phase 5 — Asset */}
          <Route path="assets" element={<AssetsPage />} />
          <Route path="assets/:assetId" element={<AssetDetailPage />} />
          {/* Wave A3 — Asset Advanced */}
          <Route path="asset-maintenance" element={<AssetMaintenancePage />} />
          <Route path="asset-maintenance/work-orders/:workOrderId" element={<AssetMaintenanceWorkOrderDetailPage />} />
          <Route path="asset-maintenance/assets/:assetId" element={<AssetPerformancePage />} />
          {/* Phase 6 — Finance */}
          <Route path="finance/accounts" element={<FinanceAccountsPage />} />
          <Route path="finance/transactions" element={<FinanceTransactionsPage />} />
          <Route path="finance/transactions/:transactionId" element={<FinanceTransactionDetailPage />} />
          <Route path="finance/cashflow" element={<CashflowPage />} />
          {/* Phase 7 — HSE */}
          <Route path="hse" element={<HseRegisterPage />} />
          <Route path="hse/report" element={<HseReportPage />} />
          <Route path="hse/records/:recordId" element={<HseDetailPage />} />
          {/* Phase 8 — Project Delivery */}
          <Route path="project-delivery" element={<ProjectDeliveryPage />} />
          <Route path="project-delivery/:projectId" element={<ProjectDeliveryDetailPage />} />
          {/* Phase 9 — Reporting & Operational Insight */}
          <Route path="reporting" element={<ReportingInsightPage />} />
          {/* Phase 11C — Business Admin Console (read-only) */}
          <Route path="admin" element={<AdminConsolePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
