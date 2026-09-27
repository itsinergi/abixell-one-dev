/**
 * Phase 11C/11E — Business Admin Console resource state.
 *
 * Every read-only console view uses the same deterministic state model. A
 * request generation ensures a stale, retried, or unmounted request cannot
 * overwrite a newer result; 401 and 403 remain distinct because an expired
 * session is not a permission decision.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../../auth/AuthContext";
import { ApiError } from "../../../lib/api";

export type AdminResourceStatus =
  | "loading"
  | "ready"
  | "denied"
  | "session-expired"
  | "error";

export interface AdminResourceState<T> {
  data: T | null;
  status: AdminResourceStatus;
  loading: boolean;
  error: string | null;
  denied: boolean;
  sessionExpired: boolean;
  reload: () => Promise<void>;
}

export function useAdminResource<T>(
  load: (token: string) => Promise<T>,
  fallbackMessage: string,
  enabled = true,
): AdminResourceState<T> {
  const { session } = useAuth();
  const token = session!.accessToken;
  const latestLoader = useRef(load);
  const generation = useRef(0);

  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<AdminResourceStatus>(
    enabled ? "loading" : "ready",
  );
  const [error, setError] = useState<string | null>(null);

  // Keep the newest loader reachable from `run` without making `run` depend on
  // it, so the mount effect below fires on token change rather than on every
  // caller re-render. Written in an effect, not during render: a render-phase
  // ref write can be dropped or applied twice under StrictMode and concurrent
  // rendering, and `run` would then call a loader from a render that never
  // committed. Declared before the run effect so it lands first on mount.
  useEffect(() => {
    latestLoader.current = load;
  });

  const run = useCallback(async () => {
    if (!enabled) return;
    const requestGeneration = ++generation.current;
    setStatus("loading");
    setError(null);

    try {
      const nextData = await latestLoader.current(token);
      if (requestGeneration !== generation.current) return;
      setData(nextData);
      setStatus("ready");
    } catch (err) {
      if (requestGeneration !== generation.current) return;
      setData(null);

      if (err instanceof ApiError && err.status === 403) {
        setStatus("denied");
        return;
      }
      if (err instanceof ApiError && err.status === 401) {
        setStatus("session-expired");
        return;
      }

      setError(err instanceof ApiError ? err.message : fallbackMessage);
      setStatus("error");
    }
  }, [enabled, fallbackMessage, token]);

  useEffect(() => {
    if (!enabled) {
      generation.current += 1;
      setData(null);
      setError(null);
      setStatus("ready");
      return;
    }
    void run();
    return () => {
      generation.current += 1;
    };
  }, [enabled, run]);

  return {
    data,
    status,
    loading: status === "loading",
    error,
    denied: status === "denied",
    sessionExpired: status === "session-expired",
    reload: run,
  };
}
