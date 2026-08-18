import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { api, ApiError } from "../lib/api";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [tenantCode, setTenantCode] = useState("demo-gs");
  const [email, setEmail] = useState("admin@demo.local");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await api.login({ tenantCode, email, password });
      login({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        userId: result.userId,
        tenantId: result.tenantId,
        tenantCode,
      });
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div>
          <h1 className="text-lg font-semibold">Enterprise Management System</h1>
          <p className="text-sm text-slate-500">Sign in to continue</p>
        </div>

        <label className="block text-sm">
          Tenant code
          <input
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
            value={tenantCode}
            onChange={(e) => setTenantCode(e.target.value)}
            required
          />
        </label>

        <label className="block text-sm">
          Email
          <input
            type="email"
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
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>

        <p className="text-xs text-slate-400">
          Checkpoint 0B demo accounts (after <code>npm run seed -w apps/api</code>):
          admin@demo.local / Admin12345! (tenant-wide) or supervisor@demo.local /
          Supervisor12345! (Site A scope only, read-only).
        </p>
      </form>
    </div>
  );
}
