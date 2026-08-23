/**
 * Phase 11C — Business Admin Console shared presentation.
 *
 * Renders the four states every read-only admin view can be in — loading,
 * permission-denied, failed, and empty — so each view declares only its
 * content. Denial is treated as a first-class, explained state rather than
 * an error, because reaching the console never implies the right to read
 * every area within it.
 */
import type { ReactNode } from "react";
import { Alert, Button, Card, EmptyState, Spinner } from "../../../shell/components/ui";

export function AdminSectionState({
  loading,
  denied,
  error,
  requiredPermission,
  onRetry,
  children,
}: {
  loading: boolean;
  denied: boolean;
  error: string | null;
  /** Named in the denial message so an administrator knows what to grant. */
  requiredPermission?: string;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (loading) return <Spinner />;

  if (denied) {
    return (
      <EmptyState
        title="You do not have access to this area"
        description={
          requiredPermission
            ? `Viewing this section requires the "${requiredPermission}" permission. Ask an administrator to grant it to one of your roles.`
            : "Your roles do not grant permission to view this section."
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
              Try again
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

export function AdminEmpty({ what }: { what: string }) {
  return <EmptyState title={`No ${what} yet`} description={`Nothing has been defined for this tenant.`} />;
}
