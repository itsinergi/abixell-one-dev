import { Navigate, Route, Routes } from "react-router-dom";
import { ApplicationShell } from "./shell/layout/ApplicationShell";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { useAuth } from "./auth/AuthContext";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, initializing } = useAuth();
  // Checkpoint 0F: wait for AuthProvider to finish validating/refreshing
  // a persisted session before deciding to redirect — otherwise a
  // returning user with a perfectly valid persisted session would flash
  // through /login on every reload while the refresh call is in flight.
  if (initializing) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Loading…
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <ApplicationShell>
              <DashboardPage />
            </ApplicationShell>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
