import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { api, ApiError, type TenantSelectionRequired } from "../lib/api";
import { useT } from "../i18n/LocaleProvider";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const t = useT();
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
      setError(err instanceof ApiError ? err.message : t("login.failed"));
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void submit();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ground">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded border border-line bg-panel p-6 shadow-xs"
      >
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink">{t("login.title")}</h1>
          <p className="text-sm text-ink-faint">{t("login.subtitle")}</p>
        </div>

        {tenantChoice ? (
          <fieldset disabled={loading} className="space-y-3">
            <legend className="text-sm text-ink-dim">{t("login.tenantLegend")}</legend>
            {tenantChoice.map((tenant) => (
              <button
                key={tenant.tenantId}
                type="button"
                onClick={() => void submit(tenant.tenantId)}
                className="flex w-full items-center justify-between rounded border border-line px-3 py-2 text-left text-sm hover:bg-panel-2 disabled:opacity-50"
              >
                <span className="font-medium text-ink">{tenant.tenantName}</span>
                <span className="text-xs text-ink-faint">{tenant.tenantCode}</span>
              </button>
            ))}
          </fieldset>
        ) : (
          <>
            <label className="block text-sm">
              {t("login.email")}
              <input
                type="email"
                autoComplete="username"
                className="mt-1 w-full rounded border border-line px-2 py-1.5"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>

            <label className="block text-sm">
              {t("login.password")}
              <input
                type="password"
                autoComplete="current-password"
                className="mt-1 w-full rounded border border-line px-2 py-1.5"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
          </>
        )}

        {error && <p className="text-sm text-status-danger">{error}</p>}

        {tenantChoice ? (
          <button
            type="button"
            onClick={() => {
              setTenantChoice(null);
              setError(null);
            }}
            disabled={loading}
            className="w-full rounded border border-line px-3 py-2 text-sm font-medium text-ink-dim disabled:opacity-50"
          >
            {t("login.otherEmail")}
          </button>
        ) : (
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-accent px-3 py-2 text-sm font-medium text-accent-on disabled:opacity-50"
          >
            {loading ? t("login.submitting") : t("login.submit")}
          </button>
        )}
      </form>
    </div>
  );
}
