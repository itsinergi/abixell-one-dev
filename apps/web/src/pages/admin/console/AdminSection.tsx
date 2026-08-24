/**
 * Phase 11C/11E — Business Admin Console shared presentation.
 *
 * Renders deterministic loading, permission-denied, expired-session, error,
 * and ready states so each view declares only its content. Reaching the console
 * never implies the right to read or change every area within it.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../auth/AuthContext";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  PermissionDeniedState,
  Spinner,
} from "../../../shell/components/ui";

export function AdminSectionState({
  loading,
  loadingLabel = "Loading administration data…",
  denied,
  sessionExpired = false,
  error,
  requiredPermission,
  onRetry,
  children,
}: {
  loading: boolean;
  loadingLabel?: string;
  denied: boolean;
  sessionExpired?: boolean;
  error: string | null;
  /** Named in the denial state so an administrator knows what to grant. */
  requiredPermission?: string;
  onRetry?: () => void;
  children: ReactNode;
}) {
  const { logout } = useAuth();

  if (loading) return <Spinner label={loadingLabel} />;

  if (denied) {
    return (
      <PermissionDeniedState
        permission={requiredPermission}
        action={
          <Link
            to="/admin"
            className="inline-flex min-h-[44px] items-center justify-center rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 sm:min-h-[36px]"
          >
            Back to overview
          </Link>
        }
      />
    );
  }

  if (sessionExpired) {
    return (
      <EmptyState
        title="Your session has expired"
        description="Sign in again to continue. No permission decision was made for this section."
        action={
          <Button onClick={logout}>
            Sign in again
          </Button>
        }
      />
    );
  }

  if (error) {
    return (
      <Alert tone="error">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>{error}</span>
          {onRetry && (
            <Button variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      </Alert>
    );
  }

  return <>{children}</>;
}

/** A titled block within a console view. */
export function AdminPanel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      <div className="mt-4">{children}</div>
    </Card>
  );
}

export function AdminEmpty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return <EmptyState title={title} description={description} />;
}
