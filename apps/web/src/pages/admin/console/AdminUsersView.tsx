import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useAuth } from "../../../auth/AuthContext";
import {
  api,
  ApiError,
  type AdminRoleAssignmentInput,
  type AdminRoleAssignmentScopeType,
  type AdminRoleAssignmentSummary,
  type AdminRolePermissions,
  type AdminRoleSummary,
  type AdminUserAccessSummary,
  type Customer,
} from "../../../lib/api";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
  StatusPill,
} from "../../../shell/components/ui";
import { OverlayDialog } from "../../../shell/components/OverlayDialog";
import { AdminPanel, AdminSectionState } from "./AdminSection";
import { useAdminResource } from "./useAdminResource";

type AccessOperation =
  | { kind: "add" }
  | { kind: "remove"; assignment: AdminRoleAssignmentSummary };
type FlowStep =
  | "select"
  | "review"
  | "pending"
  | "failed"
  | "verification-failed"
  | "success";
type AcceptedMutation = {
  operation: AccessOperation;
  addInput: AdminRoleAssignmentInput | null;
  successMessage: string;
};
type CatalogStatus = "idle" | "loading" | "ready" | "limited";
type CatalogFailureKind = "denied" | "session-expired" | "error";

type OrganizationUnitOption = { id: string; name: string };

type ScopeChoice = {
  key: string;
  scopeType: AdminRoleAssignmentScopeType;
  id: string | null;
  name: string;
  label: string;
};

function assignmentScopeName(assignment: AdminRoleAssignmentSummary): string {
  if (assignment.scopeType === "tenant") return "Tenant-wide";
  if (assignment.scopeType === "organization_unit") {
    return assignment.scopeState === "available"
      ? assignment.scopeOrganizationUnitName ?? "Unavailable organization unit"
      : "Unavailable organization unit";
  }
  return assignment.scopeState === "available"
    ? assignment.scopeCustomerName ?? "Unavailable customer"
    : "Unavailable customer";
}

function UnavailableScopeState() {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <StatusPill tone="warning">Unavailable scope</StatusPill>
      <span className="text-xs text-amber-800">This assignment currently grants no access.</span>
    </div>
  );
}

function UnavailableRoleState() {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <StatusPill tone="warning">Unavailable role</StatusPill>
      <span className="text-xs text-amber-800">Role details are not available.</span>
    </div>
  );
}

function assignmentHasAvailableRole(
  assignment: AdminRoleAssignmentSummary,
): assignment is AdminRoleAssignmentSummary & {
  roleState: "available";
  roleCode: string;
  roleName: string;
} {
  return (
    assignment.roleState === "available" &&
    assignment.roleCode !== null &&
    assignment.roleName !== null
  );
}

function AssignmentRole({
  assignment,
}: {
  assignment: AdminRoleAssignmentSummary;
}) {
  if (!assignmentHasAvailableRole(assignment)) {
    return (
      <>
        <div className="text-sm font-medium text-slate-800">Unavailable role</div>
        <UnavailableRoleState />
      </>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-sm font-medium text-slate-800">{assignment.roleName}</span>
      <code className="break-all font-mono text-xs text-slate-500">
        {assignment.roleCode}
      </code>
    </div>
  );
}

function assignmentScopeId(assignment: AdminRoleAssignmentSummary): string | null {
  return assignment.scopeOrganizationUnitId ?? assignment.scopeCustomerId;
}

function scopeLabel(assignment: AdminRoleAssignmentSummary): string {
  return assignmentScopeName(assignment);
}

function roleSearchText(user: AdminUserAccessSummary): string {
  return user.roleAssignments
    .map((assignment) => {
      if (!assignmentHasAvailableRole(assignment)) return "Unavailable role";
      return `${assignment.roleCode} ${assignment.roleName}`;
    })
    .join(" ");
}

function catalogFailureKind(reason: unknown): CatalogFailureKind {
  if (reason instanceof ApiError && reason.status === 403) return "denied";
  if (reason instanceof ApiError && reason.status === 401) return "session-expired";
  return "error";
}

function catalogFailureMessage(label: string, reason: unknown): string {
  const kind = catalogFailureKind(reason);
  if (kind === "denied") return `${label} options are unavailable to your current access.`;
  if (kind === "session-expired") return `${label} options could not be loaded because your session expired.`;
  return `${label} options could not be loaded.`;
}

function errorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  if (err.status === 401) return "Your session expired. Sign in again before changing access.";
  if (err.status === 403) return "Your current access does not allow this change.";
  if (err.status === 400 || err.status === 409 || err.status === 422) {
    return `The server rejected this access context: ${err.message}`;
  }
  return err.message || fallback;
}

export function AdminUsersView({
  canManageAccess,
}: {
  canManageAccess: boolean;
}) {
  const { data, loading, error, denied, sessionExpired, reload } =
    useAdminResource<AdminUserAccessSummary[]>(
      (token) => api.adminUsers(token),
      "Failed to load users and access assignments",
    );
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState<AdminUserAccessSummary | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const manageTriggerRef = useRef<HTMLButtonElement | null>(null);
  const PAGE_SIZE = 25;

  const filteredUsers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return data ?? [];
    return (data ?? []).filter((user) =>
      `${user.fullName} ${user.email} ${roleSearchText(user)}`
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [data, query]);

  const totalPages = Math.ceil(filteredUsers.length / PAGE_SIZE);
  const clampedPage = Math.max(1, Math.min(page, totalPages || 1));

  useEffect(() => {
    setPage(1);
  }, [query]);

  const paginatedUsers = useMemo(() => {
    const start = (clampedPage - 1) * PAGE_SIZE;
    return filteredUsers.slice(start, start + PAGE_SIZE);
  }, [filteredUsers, clampedPage]);

  function manage(
    user: AdminUserAccessSummary,
    trigger: HTMLButtonElement,
  ) {
    manageTriggerRef.current = trigger;
    setSelectedUser(user);
  }

  function closeDialog() {
    const trigger = manageTriggerRef.current;
    setSelectedUser(null);
    window.setTimeout(() => trigger?.focus(), 0);
  }

  return (
    <>
      <AdminSectionState
        loading={loading}
        loadingLabel="Loading tenant users and access…"
        denied={denied}
        sessionExpired={sessionExpired}
        error={error}
        requiredPermission="user.read"
        onRetry={reload}
      >
        <div aria-live="polite">
          {feedback && (
            <Alert tone="success">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{feedback}</span>
                <Button variant="ghost" onClick={() => setFeedback(null)}>
                  Dismiss
                </Button>
              </div>
            </Alert>
          )}
        </div>
        <AdminPanel
          title="Users and access"
          description={
            canManageAccess
              ? "Inspect current role assignments, then use a governed review to add or remove access."
              : "Inspect current role assignments. Your current access is read only."
          }
        >
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <Field label="Search users">
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name, email, or role"
                autoComplete="off"
                aria-label="Search users by name, email, or role"
                className="sm:w-80"
              />
            </Field>
            <p className="text-sm tabular-nums text-slate-500" role="status" aria-live="polite">
              Showing {filteredUsers.length} of {(data ?? []).length}
            </p>
          </div>

          {(data ?? []).length === 0 ? (
            <EmptyState
              title="No users found"
              description="No user access summaries were returned for this tenant."
            />
          ) : filteredUsers.length === 0 ? (
            <EmptyState
              title="No matching users"
              description="Try a different name, email address, or role."
              action={
                <Button variant="secondary" onClick={() => setQuery("")}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <div className="space-y-4">
              <UserResults
                users={paginatedUsers}
                canManageAccess={canManageAccess}
                onManage={manage}
              />
              <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p
                  className="text-sm tabular-nums text-slate-500"
                  role="status"
                  aria-live="polite"
                >
                  Page {clampedPage} of {totalPages}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    disabled={clampedPage <= 1}
                    onClick={() => setPage(Math.max(1, clampedPage - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={clampedPage >= totalPages}
                    onClick={() => setPage(Math.min(totalPages, clampedPage + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          )}
        </AdminPanel>
      </AdminSectionState>

      {selectedUser && (
        <AccessDialog
          key={selectedUser.id}
          user={selectedUser}
          canManageAccess={canManageAccess}
          onClose={closeDialog}
          onReload={reload}
          restoreFocusRef={manageTriggerRef}
          onSuccess={(message) => {
            setFeedback(message);
            closeDialog();
          }}
        />
      )}
    </>
  );
}

function UserResults({
  users,
  canManageAccess,
  onManage,
}: {
  users: AdminUserAccessSummary[];
  canManageAccess: boolean;
  onManage: (user: AdminUserAccessSummary, trigger: HTMLButtonElement) => void;
}) {
  return (
    <>
      <ul className="space-y-3 md:hidden">
        {users.map((user) => (
          <li key={user.id} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="min-w-0">
                <div className="break-words text-sm font-semibold text-slate-900">{user.fullName}</div>
                <div className="mt-0.5 break-all text-sm text-slate-500">{user.email}</div>
              </div>
              <StatusPill tone={user.status === "active" ? "success" : "neutral"}>
                {user.status}
              </StatusPill>
            </div>
            <div className="mt-3 space-y-2">
              {user.roleAssignments.length === 0 ? (
                <span className="text-sm text-slate-500">No role assignments</span>
              ) : (
                user.roleAssignments.map((assignment) => (
                  <div key={assignment.id} className="rounded-md bg-slate-50 px-2.5 py-2">
                    <AssignmentRole assignment={assignment} />
                    <div className="mt-0.5 text-xs text-slate-500">{scopeLabel(assignment)}</div>
                    {assignment.scopeState === "unavailable" && <UnavailableScopeState />}
                  </div>
                ))
              )}
            </div>
            {canManageAccess && (
              <Button
                className="mt-4 min-h-[44px] w-full"
                onClick={(event) => onManage(user, event.currentTarget)}
              >
                Manage access
              </Button>
            )}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 md:block">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">User</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Roles</th>
              <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Access</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {users.map((user) => (
              <tr key={user.id}>
                <td className="px-3 py-3 align-top">
                  <div className="font-medium text-slate-900">{user.fullName}</div>
                  <div className="mt-0.5 break-all text-slate-500">{user.email}</div>
                </td>
                <td className="px-3 py-3 align-top">
                  <StatusPill tone={user.status === "active" ? "success" : "neutral"}>
                    {user.status}
                  </StatusPill>
                </td>
                <td className="px-3 py-3 align-top">
                  <div className="flex max-w-xl flex-wrap gap-1.5">
                    {user.roleAssignments.length === 0 ? (
                      <span className="text-slate-500">No role assignments</span>
                    ) : (
                      user.roleAssignments.map((assignment) => (
                        <div key={assignment.id} className="inline-flex flex-col rounded-md bg-slate-50 px-2 py-1.5">
                          <AssignmentRole assignment={assignment} />
                          <span className="text-xs text-slate-500">{scopeLabel(assignment)}</span>
                          {assignment.scopeState === "unavailable" && <UnavailableScopeState />}
                        </div>
                      ))
                    )}
                  </div>
                </td>
                <td className="px-3 py-3 text-right align-top">
                  {canManageAccess ? (
                    <Button
                      className="min-h-[44px]"
                      onClick={(event) => onManage(user, event.currentTarget)}
                    >
                      Manage access
                    </Button>
                  ) : (
                    <span className="text-xs text-slate-500">Read only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AccessDialog({
  user,
  canManageAccess,
  onClose,
  onReload,
  restoreFocusRef,
  onSuccess,
}: {
  user: AdminUserAccessSummary;
  canManageAccess: boolean;
  onClose: () => void;
  onReload: () => Promise<void>;
  restoreFocusRef: RefObject<HTMLElement>;
  onSuccess: (message: string) => void;
}) {
  const { session, logout } = useAuth();
  const token = session!.accessToken;
  const [step, setStep] = useState<FlowStep>("select");
  const [operation, setOperation] = useState<AccessOperation>({ kind: "add" });
  const [roles, setRoles] = useState<AdminRoleSummary[]>([]);
  const [catalogState, setCatalogState] = useState<CatalogStatus>("idle");
  const [catalogNotes, setCatalogNotes] = useState<string[]>([]);
  const [catalogSessionExpired, setCatalogSessionExpired] = useState(false);
  const [scopeChoices, setScopeChoices] = useState<ScopeChoice[]>([
    { key: "tenant", scopeType: "tenant", id: null, name: "Tenant-wide", label: "Tenant-wide" },
  ]);
  const [selectedRoleCode, setSelectedRoleCode] = useState("");
  const [selectedScopeKey, setSelectedScopeKey] = useState("tenant");
  const [permissions, setPermissions] = useState<AdminRolePermissions | null>(null);
  const [permissionState, setPermissionState] = useState<
    "idle" | "loading" | "ready" | "denied" | "session-expired" | "error"
  >("idle");
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [acceptedMutation, setAcceptedMutation] = useState<AcceptedMutation | null>(null);
  const submitGuard = useRef(false);
  const permissionRequestId = useRef(0);

  const pending = step === "pending";
  const selectedRole = roles.find((role) => role.code === selectedRoleCode) ?? null;
  const selectedScope = scopeChoices.find((scope) => scope.key === selectedScopeKey) ?? scopeChoices[0];
  const targetRole = operation.kind === "remove"
    ? assignmentHasAvailableRole(operation.assignment)
      ? {
          code: operation.assignment.roleCode,
          name: operation.assignment.roleName,
        }
      : null
    : selectedRole;
  const unavailableRoleRemoval =
    operation.kind === "remove" &&
    operation.assignment.roleState === "unavailable";
  const permissionMatchesTarget =
    permissionState === "ready" &&
    permissions !== null &&
    targetRole !== null &&
    permissions.roleCode === targetRole.code;
  const permissionReviewSatisfied =
    unavailableRoleRemoval || permissionMatchesTarget;

  const loadCatalogs = useCallback(async () => {
    if (!canManageAccess) return;
    setCatalogState("loading");
    const [roleResult, ouResult, customerResult] = await Promise.allSettled([
      api.adminRoles(token),
      api.organizationUnits(token),
      api.customers(token),
    ]);

    if (roleResult.status === "fulfilled") {
      setRoles(roleResult.value);
      setSelectedRoleCode((current) => current || roleResult.value[0]?.code || "");
    } else {
      setRoles([]);
    }

    const notes: string[] = [];
    const nextChoices: ScopeChoice[] = [
      { key: "tenant", scopeType: "tenant", id: null, name: "Tenant-wide", label: "Tenant-wide" },
    ];
    if (ouResult.status === "fulfilled") {
      for (const unit of ouResult.value as OrganizationUnitOption[]) {
        nextChoices.push({
          key: `organization_unit:${unit.id}`,
          scopeType: "organization_unit",
          id: unit.id,
          name: unit.name,
          label: `Organization unit · ${unit.name}`,
        });
      }
    } else {
      notes.push(catalogFailureMessage("Organization unit", ouResult.reason));
    }
    if (customerResult.status === "fulfilled") {
      for (const customer of customerResult.value as Customer[]) {
        nextChoices.push({
          key: `customer:${customer.id}`,
          scopeType: "customer",
          id: customer.id,
          name: customer.name,
          label: `Customer · ${customer.name}`,
        });
      }
    } else {
      notes.push(catalogFailureMessage("Customer", customerResult.reason));
    }
    if (roleResult.status === "rejected") {
      notes.push(`${catalogFailureMessage("Role", roleResult.reason)} New assignments are unavailable.`);
    }
    const sessionExpired = [roleResult, ouResult, customerResult].some(
      (result) => result.status === "rejected" && catalogFailureKind(result.reason) === "session-expired",
    );
    setCatalogSessionExpired(sessionExpired);
    setScopeChoices(nextChoices);
    setCatalogNotes(notes);
    setCatalogState(notes.length > 0 ? "limited" : "ready");
  }, [canManageAccess, token]);

  useEffect(() => {
    void loadCatalogs();
  }, [loadCatalogs]);

  useEffect(() => {
    return () => {
      permissionRequestId.current += 1;
    };
  }, []);

  const invalidatePermissionRequest = useCallback(() => {
    permissionRequestId.current += 1;
    setPermissions(null);
    setPermissionError(null);
    setPermissionState("idle");
  }, []);

  const loadPermissions = useCallback(
    async (roleCode: string) => {
      const requestId = ++permissionRequestId.current;
      setPermissions(null);
      setPermissionError(null);
      setPermissionState("loading");
      try {
        const result = await api.adminRolePermissions(token, roleCode);
        if (requestId !== permissionRequestId.current) return;
        setPermissions(result);
        setPermissionState("ready");
      } catch (err) {
        if (requestId !== permissionRequestId.current) return;
        if (err instanceof ApiError && err.status === 403) setPermissionState("denied");
        else if (err instanceof ApiError && err.status === 401) setPermissionState("session-expired");
        else {
          setPermissionError(err instanceof ApiError ? err.message : "Failed to load permission summary");
          setPermissionState("error");
        }
      }
    },
    [token],
  );

  function startAddReview() {
    if (!selectedRole || !selectedScope) return;
    setOperation({ kind: "add" });
    setStep("review");
    void loadPermissions(selectedRole.code);
  }

  function startRemoveReview(assignment: AdminRoleAssignmentSummary) {
    setOperation({ kind: "remove", assignment });
    setStep("review");
    if (assignmentHasAvailableRole(assignment)) {
      void loadPermissions(assignment.roleCode);
    } else {
      invalidatePermissionRequest();
    }
  }

  function assignmentInput(): AdminRoleAssignmentInput | null {
    if (!selectedRole || !selectedScope) return null;
    if (selectedScope.scopeType === "tenant") {
      return { roleCode: selectedRole.code, scopeType: "tenant" };
    }
    if (selectedScope.scopeType === "organization_unit" && selectedScope.id) {
      return {
        roleCode: selectedRole.code,
        scopeType: "organization_unit",
        scopeOrganizationUnitId: selectedScope.id,
      };
    }
    if (selectedScope.scopeType === "customer" && selectedScope.id) {
      return {
        roleCode: selectedRole.code,
        scopeType: "customer",
        scopeCustomerId: selectedScope.id,
      };
    }
    return null;
  }

  async function verifyAcceptedChange(accepted: AcceptedMutation) {
    const authoritativeUsers = await api.adminUsers(token);
    const authoritativeUser = authoritativeUsers.find((candidate) => candidate.id === user.id);
    if (!authoritativeUser) {
      throw new Error("The user was not present in the authoritative reload.");
    }

    if (accepted.operation.kind === "add") {
      const input = accepted.addInput;
      if (!input) throw new Error("The accepted assignment context is unavailable.");
      const found = authoritativeUser.roleAssignments.some((assignment) => {
        if (assignment.roleCode !== input.roleCode || assignment.scopeType !== input.scopeType) return false;
        if (input.scopeType === "tenant") return true;
        if (input.scopeType === "organization_unit") {
          return assignment.scopeOrganizationUnitId === input.scopeOrganizationUnitId;
        }
        return assignment.scopeCustomerId === input.scopeCustomerId;
      });
      if (!found) throw new Error("The authoritative reload did not contain the new assignment.");
    } else {
      const removedAssignmentId = accepted.operation.assignment.id;
      if (
        authoritativeUser.roleAssignments.some(
          (item) => item.id === removedAssignmentId,
        )
      ) {
        throw new Error("The authoritative reload still contains the removed assignment.");
      }
    }

    await onReload();
    setStep("success");
    // Preserve the explicit success state long enough for assistive technology
    // to receive it before the authoritative parent view replaces the dialog.
    window.setTimeout(() => onSuccess(accepted.successMessage), 0);
  }

  function verificationFailureMessage(err: unknown): string {
    if (err instanceof ApiError && err.status === 401) {
      return "The change was accepted, but your session expired before the updated access could be verified.";
    }
    if (err instanceof ApiError && err.status === 403) {
      return "The change was accepted, but your current access cannot reload the user to verify it.";
    }
    const detail = err instanceof Error ? err.message : "The updated user could not be reloaded.";
    return `The change was accepted, but verification could not be completed: ${detail}`;
  }

  async function retryVerification() {
    if (submitGuard.current || !acceptedMutation) return;
    submitGuard.current = true;
    setStep("pending");
    setMutationError(null);
    try {
      await verifyAcceptedChange(acceptedMutation);
    } catch (err) {
      setMutationError(verificationFailureMessage(err));
      setStep("verification-failed");
    } finally {
      submitGuard.current = false;
    }
  }

  async function confirmMutation() {
    if (submitGuard.current || pending || !permissionReviewSatisfied) return;
    const addInput = operation.kind === "add" ? assignmentInput() : null;
    if (operation.kind === "add" && !addInput) return;

    const accepted: AcceptedMutation = {
      operation,
      addInput,
      successMessage:
        operation.kind === "add"
          ? `Added ${targetRole?.name ?? "role"} access for ${user.fullName}.`
          : assignmentHasAvailableRole(operation.assignment)
            ? `Removed ${operation.assignment.roleName} access from ${user.fullName}.`
            : `Removed unavailable role assignment from ${user.fullName}.`,
    };
    submitGuard.current = true;
    setStep("pending");
    setMutationError(null);
    setAcceptedMutation(null);

    try {
      if (operation.kind === "add") {
        await api.addAdminUserRoleAssignment(token, user.id, addInput!);
      } else {
        await api.deleteAdminUserRoleAssignment(token, user.id, operation.assignment.id);
      }
    } catch (err) {
      setMutationError(errorMessage(err, "The access change could not be completed."));
      setStep("failed");
      submitGuard.current = false;
      return;
    }

    // The server has accepted the mutation. From this point onward no UI path
    // may repeat POST/DELETE; retry is strictly an authoritative GET reload.
    setAcceptedMutation(accepted);
    try {
      await verifyAcceptedChange(accepted);
    } catch (err) {
      setMutationError(verificationFailureMessage(err));
      setStep("verification-failed");
    } finally {
      submitGuard.current = false;
    }
  }

  const dialogTitle = canManageAccess ? `Manage access · ${user.fullName}` : `Access · ${user.fullName}`;
  const closeAccessDialog = useCallback(() => {
    invalidatePermissionRequest();
    onClose();
  }, [invalidatePermissionRequest, onClose]);

  return (
    <OverlayDialog
      open
      title={dialogTitle}
      description={<span className="break-all">{user.email}</span>}
      pending={pending}
      onClose={closeAccessDialog}
      restoreFocusRef={restoreFocusRef}
      size="lg"
      footer={
        step === "select" ? (
          <Button variant="secondary" className="min-h-[44px]" onClick={closeAccessDialog}>
            Close
          </Button>
        ) : step === "review" || step === "failed" ? (
          <>
            <Button
              variant="secondary"
              className="min-h-[44px]"
              onClick={() => {
                invalidatePermissionRequest();
                setMutationError(null);
                setAcceptedMutation(null);
                setStep("select");
                setOperation({ kind: "add" });
              }}
            >
              Back
            </Button>
            <Button
              className="min-h-[44px]"
              disabled={!permissionReviewSatisfied || submitGuard.current}
              onClick={() => void confirmMutation()}
            >
              Confirm {operation.kind === "add" ? "add" : "remove"}
            </Button>
          </>
        ) : step === "verification-failed" ? (
          <>
            <Button
              variant="secondary"
              className="min-h-[44px]"
              onClick={closeAccessDialog}
            >
              Close
            </Button>
            <Button
              className="min-h-[44px]"
              disabled={!acceptedMutation || submitGuard.current}
              onClick={() => void retryVerification()}
            >
              Retry verification
            </Button>
          </>
        ) : pending ? (
          <Button className="min-h-[44px]" disabled>
            {acceptedMutation ? "Verifying applied change…" : "Saving change…"}
          </Button>
        ) : null
      }
    >
      {step === "select" && (
        <div className="space-y-6">
          <section aria-labelledby="current-access-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="current-access-title" className="text-sm font-semibold text-slate-900">Current access</h3>
              {!canManageAccess && <Badge>Read only</Badge>}
            </div>
            {user.roleAssignments.length === 0 ? (
              <EmptyState
                title="No role assignments"
                description="This user currently has no assigned roles."
              />
            ) : (
              <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
                {user.roleAssignments.map((assignment) => (
                  <li key={assignment.id} className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <AssignmentRole assignment={assignment} />
                      <div className="mt-1 break-words text-sm text-slate-500">{scopeLabel(assignment)}</div>
                      {assignment.scopeState === "unavailable" && <UnavailableScopeState />}
                    </div>
                    {canManageAccess && (
                      <Button
                        variant="secondary"
                        className="min-h-[44px] shrink-0"
                        onClick={() => {
                            startRemoveReview(assignment);
                        }}
                      >
                        Review removal
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {canManageAccess && (
            <section className="border-t border-slate-200 pt-5" aria-labelledby="add-access-title">
              <h3 id="add-access-title" className="text-sm font-semibold text-slate-900">Add access</h3>
              {catalogState === "loading" || catalogState === "idle" ? (
                <Spinner label="Loading governed choices…" />
              ) : (
                <div className="mt-3 space-y-4">
                  {catalogSessionExpired ? (
                    <EmptyState
                      title="Your session has expired"
                      description="Sign in again before choosing access scope. No access change can be reviewed."
                      action={<Button onClick={logout}>Sign in again</Button>}
                    />
                  ) : catalogNotes.length > 0 ? (
                    <Alert tone="warning">
                      <div className="space-y-1">
                        {catalogNotes.map((note) => <p key={note}>{note}</p>)}
                        <p>Available safe choices remain selectable; no raw scope IDs can be entered.</p>
                      </div>
                    </Alert>
                  ) : null}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Role" required>
                      <Select
                        value={selectedRoleCode}
                        onChange={(event) => setSelectedRoleCode(event.target.value)}
                        disabled={roles.length === 0}
                      >
                        {roles.length === 0 ? <option value="">No roles available</option> : roles.map((role) => (
                          <option key={role.code} value={role.code}>{role.name} ({role.code})</option>
                        ))}
                      </Select>
                    </Field>
                    <Field
                      label="Scope"
                      required
                      hint="Options reflect the scope catalogs your current access can read; tenant-wide remains available."
                    >
                      <Select value={selectedScopeKey} onChange={(event) => setSelectedScopeKey(event.target.value)}>
                        {scopeChoices.map((scope) => (
                          <option key={scope.key} value={scope.key}>{scope.label}</option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <Button
                    className="min-h-[44px] w-full sm:w-auto"
                    disabled={catalogSessionExpired || !selectedRoleCode || !selectedScopeKey}
                    onClick={startAddReview}
                  >
                    Review assignment
                  </Button>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {step === "success" && (
        <Alert tone="success">The server confirmed the change and the user list was reloaded.</Alert>
      )}

      {step === "verification-failed" && acceptedMutation && (
        <div className="space-y-5">
          <Alert tone="warning">
            <div className="space-y-1">
              <p className="font-medium">Change applied; verification reload failed.</p>
              <p>{mutationError}</p>
              <p>
                Retry verification reloads user access with GET only. It will not repeat the
                assignment change.
              </p>
            </div>
          </Alert>
          <ChangeSummary
            operation={acceptedMutation.operation}
            user={user}
            role={
              acceptedMutation.operation.kind === "remove"
                ? assignmentHasAvailableRole(
                    acceptedMutation.operation.assignment,
                  )
                  ? {
                      code: acceptedMutation.operation.assignment.roleCode,
                      name: acceptedMutation.operation.assignment.roleName,
                    }
                  : null
                : targetRole
            }
            scope={selectedScope}
            applied
          />
        </div>
      )}

      {(step === "review" || step === "failed" || step === "pending") && (
        <div className="space-y-5">
          {mutationError && <Alert tone="error">{mutationError}</Alert>}
          <ChangeSummary
            operation={operation}
            user={user}
            role={targetRole}
            scope={selectedScope}
          />
          {unavailableRoleRemoval ? (
            <Alert tone="warning">
              <div className="space-y-1">
                <p className="font-medium">Role permission review is unavailable.</p>
                <p>
                  No role identity or permission metadata is resolved for this
                  authorization-inert assignment. Removal targets only the exact
                  assignment ID shown above.
                </p>
              </div>
            </Alert>
          ) : (
            <PermissionSummary
              state={permissionState}
              details={permissions}
              error={permissionError}
              onRetry={() => targetRole && void loadPermissions(targetRole.code)}
              onSessionExpired={logout}
            />
          )}
          {pending && (
            <Alert tone="info">
              {acceptedMutation
                ? "The change was already accepted. User access is being reloaded with GET only so the result can be verified. This dialog cannot be closed yet."
                : "The server is applying the change and the user list will be reloaded before success is reported. This dialog cannot be closed yet."}
            </Alert>
          )}
        </div>
      )}
    </OverlayDialog>
  );
}

function ChangeSummary({
  operation,
  user,
  role,
  scope,
  applied = false,
}: {
  operation: AccessOperation;
  user: AdminUserAccessSummary;
  role: { code: string; name: string } | null;
  scope: ScopeChoice;
  applied?: boolean;
}) {
  const assignment = operation.kind === "remove" ? operation.assignment : null;
  const scopeType = assignment?.scopeType ?? scope.scopeType;
  const scopeName = assignment ? assignmentScopeName(assignment) : scope.name;
  const scopeId = assignment ? assignmentScopeId(assignment) : scope.id;

  return (
    <section aria-labelledby="change-summary-title" className="rounded-lg border border-slate-300 bg-slate-50 p-4">
      <h3 id="change-summary-title" className="text-sm font-semibold text-slate-900">
        {applied ? "Change accepted by the server" : "What will change"}
      </h3>
      {assignment &&
        (assignment.roleState === "unavailable" ||
          assignment.scopeState === "unavailable") && (
          <Alert tone="warning">
            <div className="space-y-1">
              <p className="font-medium">This assignment is already authorization-inert.</p>
              <p>
                Removing it clears the retained record and prevents future reuse. Restoring or
                moving a target back will not reactivate this assignment; access must be assigned
                again explicitly.
              </p>
            </div>
          </Alert>
        )}
      <dl className="mt-3 grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2">
        <SummaryItem label="Operation">{operation.kind === "add" ? "Add role assignment" : "Remove role assignment"}</SummaryItem>
        <SummaryItem label="User">{user.fullName} · {user.email}</SummaryItem>
        <SummaryItem label="Role">
          {role ? (
            <>
              {role.name} · <code className="font-mono text-xs">{role.code}</code>
            </>
          ) : (
            "Unavailable role"
          )}
        </SummaryItem>
        {assignment && (
          <SummaryItem label="Role state">
            {assignment.roleState === "available" ? "Available" : "Unavailable"}
          </SummaryItem>
        )}
        <SummaryItem label="Scope type"><code className="font-mono text-xs">{scopeType}</code></SummaryItem>
        {assignment && (
          <SummaryItem label="Scope state">
            {assignment.scopeState === "available" ? "Available" : "Unavailable — grants no access"}
          </SummaryItem>
        )}
        <SummaryItem label="Scope label">{scopeName}</SummaryItem>
        <SummaryItem label="Scope ID">{scopeId ?? "Tenant (no scope ID)"}</SummaryItem>
        {assignment && <SummaryItem label="Assignment ID"><code className="break-all font-mono text-xs">{assignment.id}</code></SummaryItem>}
      </dl>
    </section>
  );
}

function SummaryItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-slate-800">{children}</dd>
    </div>
  );
}

function PermissionSummary({
  state,
  details,
  error,
  onRetry,
  onSessionExpired,
}: {
  state: "idle" | "loading" | "ready" | "denied" | "session-expired" | "error";
  details: AdminRolePermissions | null;
  error: string | null;
  onRetry: () => void;
  onSessionExpired: () => void;
}) {
  return (
    <section aria-labelledby="permission-summary-title">
      <h3 id="permission-summary-title" className="text-sm font-semibold text-slate-900">Actual role permission summary</h3>
      <div className="mt-3">
        {(state === "idle" || state === "loading") && <Spinner label="Loading current role permissions…" />}
        {state === "denied" && (
          <Alert tone="error">Permission membership is restricted. The change cannot be confirmed without its on-demand summary.</Alert>
        )}
        {state === "session-expired" && (
          <EmptyState
            title="Your session has expired"
            description="Sign in again before changing access."
            action={<Button onClick={onSessionExpired}>Sign in again</Button>}
          />
        )}
        {state === "error" && (
          <Alert tone="error">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{error}</span>
              <Button variant="secondary" onClick={onRetry}>Retry</Button>
            </div>
          </Alert>
        )}
        {state === "ready" && details && (
          <div className="rounded-lg border border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-3">
              <div>
                <span className="font-medium text-slate-900">{details.roleName}</span>{" "}
                <code className="font-mono text-xs text-slate-600">{details.roleCode}</code>
              </div>
              {details.isFullAccess ? <StatusPill tone="warning">Full access</StatusPill> : <StatusPill tone="neutral">Scoped access</StatusPill>}
            </div>
            {details.permissions.length === 0 ? (
              <p className="px-3 py-4 text-sm text-slate-500">No permission grants are currently listed.</p>
            ) : (
              <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto">
                {details.permissions.map((permission) => (
                  <li key={permission.code} className="px-3 py-2.5">
                    <code className="break-all font-mono text-xs font-medium text-slate-800">{permission.code}</code>
                    <p className="mt-0.5 text-sm text-slate-500">{permission.description}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
