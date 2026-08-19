import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AppShell } from "./shell/layout/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { OverviewPage } from "./pages/OverviewPage";
import { DashboardPage } from "./pages/DashboardPage";
import { SectionPlaceholder } from "./pages/SectionPlaceholder";
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
          <Route
            path="complaints"
            element={
              <SectionPlaceholder
                title="Complaints"
                checkpoint="1C.2 / 1C.3"
                description="Raise, track, and act on complaints within your scope."
              />
            }
          />
          <Route
            path="verification"
            element={
              <SectionPlaceholder
                title="Verification"
                checkpoint="1C.4"
                description="Independently verify corrective actions awaiting sign-off."
              />
            }
          />
          <Route
            path="management"
            element={
              <SectionPlaceholder
                title="Management"
                checkpoint="1C.5"
                description="Complaint performance, SLA, and escalation visibility."
              />
            }
          />
          <Route path="administration" element={<DashboardPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
