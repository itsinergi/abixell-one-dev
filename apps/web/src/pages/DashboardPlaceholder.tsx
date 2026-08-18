import { useEffect, useState } from "react";

type ApiHealth = {
  status: string;
  service: string;
  checkpoint: string;
};

export function DashboardPlaceholder() {
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then(setHealth)
      .catch(() => setError("API unreachable"));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Checkpoint 0A — Project Bootstrap</h1>
      <p className="text-sm text-slate-600">
        Application Shell skeleton is running. Business dashboards land in
        Checkpoint 0B once Tenant/Organization/User/RBAC exist.
      </p>
      <div className="rounded border border-slate-200 bg-white p-4 text-sm">
        <div className="font-medium">API connectivity</div>
        {error && <div className="mt-1 text-red-600">{error}</div>}
        {health && (
          <pre className="mt-1 text-slate-600">{JSON.stringify(health, null, 2)}</pre>
        )}
        {!health && !error && <div className="mt-1 text-slate-400">Checking…</div>}
      </div>
    </div>
  );
}
