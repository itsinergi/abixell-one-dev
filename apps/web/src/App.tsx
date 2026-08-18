import { Routes, Route } from "react-router-dom";
import { ApplicationShell } from "./shell/layout/ApplicationShell";
import { DashboardPlaceholder } from "./pages/DashboardPlaceholder";

export default function App() {
  return (
    <ApplicationShell>
      <Routes>
        <Route path="/" element={<DashboardPlaceholder />} />
      </Routes>
    </ApplicationShell>
  );
}
