import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { api, ApiError, type TenantSelectionRequired } from "../lib/api";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Set once the password verifies against more than one tenant: the form is
  // replaced by a tenant list, and picking one re-submits the same
  // credentials with that tenant. No credential is issued before this point.
  const [tenantChoice, setTenantChoice] = useState<TenantSelectionRequired["tenants"] | null>(
    null,
  );

  async function submit(tenantId?: string) {
    setError(null);
    setLoading(true);
    try {
      const result = await api.login({ email, password, ...(tenantId ? { tenantId } : {}) });
      if (result.status === "tenant_selection_required") {
        setTenantChoice(result.tenants);
        return;
      }
      login({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        userId: result.userId,
        tenantId: result.tenantId,
        tenantCode: result.tenantCode,
        // Epic 1 (§4.1 B): the session the token names. The active Role
        // lives on the server-side session row, so the picker below
        // switches it through the API rather than storing it locally.
        sessionId: result.sessionId,
      });
      // Always route through the role & site picker, even for a single
      // assignment — the user's chosen work context is what shapes the shell.
      navigate("/select-workspace", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void submit();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded border border-slate-200 bg-white p-6 shadow-xs"
      >
        <div>
          <h1 className="text-lg font-semibold">Enterprise Management System</h1>
          <p className="text-sm text-slate-500">Sign in to continue</p>
        </div>

        {tenantChoice ? (
          <fieldset disabled={loading} className="space-y-3">
            <legend className="text-sm text-slate-600">
              This email is registered in more than one organization. Choose one to continue.
            </legend>
            {tenantChoice.map((tenant) => (
              <button
                key={tenant.tenantId}
                type="button"
                onClick={() => void submit(tenant.tenantId)}
                className="flex w-full items-center justify-between rounded border border-slate-300 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                <span className="font-medium text-slate-900">{tenant.tenantName}</span>
                <span className="text-xs text-slate-500">{tenant.tenantCode}</span>
              </button>
            ))}
          </fieldset>
        ) : (
          <>
            <label className="block text-sm">
              Email
              <input
                type="email"
                autoComplete="username"
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>

            <label className="block text-sm">
              Password
              <input
                type="password"
                autoComplete="current-password"
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
          </>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        {tenantChoice ? (
          <button
            type="button"
            onClick={() => {
              setTenantChoice(null);
              setError(null);
            }}
            disabled={loading}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
          >
            Use a different email
          </button>
        ) : (
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        )}
      </form>
    </div>
  );
}
