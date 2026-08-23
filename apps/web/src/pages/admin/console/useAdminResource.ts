/**
 * Phase 11C — Business Admin Console.
 *
 * The one loading pattern every read-only console view shares: fetch once
 * against the actor's token, expose loading/error/data. Extracted so the
 * five views stay declarative and cannot drift apart in how they report a
 * failure or a denial.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../auth/AuthContext";
import { ApiError } from "../../../lib/api";

export interface AdminResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Set when the backend refused the read, so the view can render a
   * permission-denial state rather than a generic failure. */
  denied: boolean;
  reload: () => void;
}

export function useAdminResource<T>(
  load: (token: string) => Promise<T>,
  fallbackMessage: string,
): AdminResourceState<T> {
  const { session } = useAuth();
  const token = session!.accessToken;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDenied(false);
    try {
      setData(await load(token));
    } catch (err) {
      // 403 is an expected outcome here, not a fault: the console is
      // reachable by anyone holding admin.console.read, while each area
      // carries its own permission.
      if (err instanceof ApiError && (err.status === 403 || err.status === 401)) {
        setDenied(true);
      }
      setError(err instanceof ApiError ? err.message : fallbackMessage);
    } finally {
      setLoading(false);
    }
    // `load` is deliberately NOT a dependency: call sites pass an inline
    // arrow (`(t) => api.adminRoles(t)`), which is a fresh reference on every
    // render and would otherwise drive an endless refetch loop.
  }, [token, fallbackMessage]);

  useEffect(() => {
    run();
  }, [run]);

  return { data, loading, error, denied, reload: run };
}
