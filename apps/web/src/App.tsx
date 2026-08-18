import { Navigate, Route, Routes } from "react-router-dom";
import { ApplicationShell } from "./shell/layout/ApplicationShell";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { useAuth } from "./auth/AuthContext";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
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
