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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
