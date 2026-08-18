import { createContext, useContext, useMemo, useState, type PropsWithChildren } from "react";

interface Session {
  accessToken: string;
  refreshToken: string;
  userId: string;
  tenantId: string;
  tenantCode: string;
}

interface AuthContextValue {
  session: Session | null;
  login: (session: Session) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Session lives in memory only for Checkpoint 0B — no localStorage/
// sessionStorage decision has been made yet for token persistence across
// page reloads. That is an explicit open item, not an oversight: see
// docs/decision-log.md.
export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      login: (s) => setSession(s),
      logout: () => setSession(null),
    }),
    [session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
