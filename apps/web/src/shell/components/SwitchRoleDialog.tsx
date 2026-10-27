/**
 * Epic 1 (§4.1 C) — switch the session's active Role without re-login.
 *
 * Same offer as the post-login picker (only role+scope pairs the caller
 * already holds — choosing one can never widen authority), but it talks to
 * POST /auth/switch-role instead of writing client state: the sessions row
 * is the source of truth, and the shell re-fetches /me (permissions, menu)
 * after the switch.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type MyRoleAssignment } from "../../lib/api";
import { Alert, Button, Field, Select, Spinner } from "./ui";
import { OverlayDialog } from "./OverlayDialog";

/** Human label for one assignment's Data Scope — the same wording as the
 * post-login picker (RoleSiteSelectionPage), one source of truth per
 * concept, not a restyled variant. */
function scopeLabel(assignment: MyRoleAssignment): string {
  switch (assignment.scopeType) {
    case "tenant":
      return "All sites (tenant-wide)";
    case "legal_entity":
      return assignment.scopeLegalEntityName ?? "Legal entity";
    case "customer":
      return assignment.scopeCustomerName ?? "Customer";
    default:
      return assignment.scopeOrganizationUnitName ?? "Organization unit";
  }
}

export function SwitchRoleDialog({
  open,
  token,
  currentAssignmentId,
  onClose,
  onSwitched,
}: {
  open: boolean;
  token: string;
  currentAssignmentId?: string;
  onClose: () => void;
  /** Called with the new session context after the server accepts the
   * switch; the caller records it and re-fetches /me. */
  onSwitched: (patch: { assignmentId: string; activeRoleName: string; activeScopeName: string }) => void;
}) {
  const [assignments, setAssignments] = useState<MyRoleAssignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roleCode, setRoleCode] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const [pending, setPending] = useState(false);
  const submitButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setAssignments(null);
    setError(null);
    api
      .me(token)
      .then((me) => {
        if (cancelled) return;
        setAssignments(me.assignments);
        const preferred =
          me.assignments.find((a) => a.id === currentAssignmentId) ?? me.assignments[0];
        if (preferred) {
          setRoleCode(preferred.roleCode);
          setAssignmentId(preferred.id);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load your access");
      });
    return () => {
      cancelled = true;
    };
    // The list is refetched on every open: an admin may have granted or
    // revoked an assignment since the dialog was last shown.
  }, [open, token, currentAssignmentId]);

  // One entry per Role; a Role may carry several scopes, which the second
  // control narrows — same structure as the post-login picker.
  const roles = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of assignments ?? []) seen.set(a.roleCode, a.roleName);
    return Array.from(seen, ([code, name]) => ({ code, name }));
  }, [assignments]);

  const scopes = useMemo(
    () => (assignments ?? []).filter((a) => a.roleCode === roleCode),
    [assignments, roleCode],
  );

  function chooseRole(nextRole: string) {
    setRoleCode(nextRole);
    const first = (assignments ?? []).find((a) => a.roleCode === nextRole);
    setAssignmentId(first?.id ?? "");
  }

  async function handleSwitch() {
    if (!assignmentId || assignmentId === currentAssignmentId) {
      onClose();
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api.switchRole(token, assignmentId);
      const chosen = assignments?.find((a) => a.id === assignmentId);
      const scopeName =
        chosen?.scopeType === "tenant"
          ? "tenant"
          : chosen?.scopeOrganizationUnitName ?? chosen?.scopeCustomerName ?? "";
      onSwitched({
        assignmentId,
        activeRoleName: chosen?.roleName ?? "",
        activeScopeName: scopeName,
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not switch role");
    } finally {
      setPending(false);
    }
  }

  return (
    <OverlayDialog
      open={open}
      title="Switch role"
      description="Your permissions, navigation, and pending tasks follow the role you pick. You only see options your account already has."
      pending={pending}
      onClose={onClose}
      initialFocusRef={submitButtonRef}
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        {!assignments && !error && <Spinner label="Loading your access…" />}

        {assignments && assignments.length === 0 && (
          <Alert tone="warning">
            Your account has no role assigned yet. Ask an administrator to grant you access.
          </Alert>
        )}

        {assignments && assignments.length > 0 && (
          <>
            <Field label="Role" required>
              <Select value={roleCode} onChange={(e) => chooseRole(e.target.value)} disabled={pending}>
                {roles.map((role) => (
                  <option key={role.code} value={role.code}>
                    {role.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Site" required>
              <Select
                value={assignmentId}
                onChange={(e) => setAssignmentId(e.target.value)}
                disabled={pending}
              >
                {scopes.map((scope) => (
                  <option key={scope.id} value={scope.id}>
                    {scopeLabel(scope)}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button
                ref={submitButtonRef}
                type="button"
                onClick={() => void handleSwitch()}
                disabled={!assignmentId || pending}
              >
                {pending ? "Switching…" : "Switch"}
              </Button>
            </div>
          </>
        )}
      </div>
    </OverlayDialog>
  );
}
