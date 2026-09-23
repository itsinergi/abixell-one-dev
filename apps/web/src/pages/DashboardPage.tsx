import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { api, ApiError } from "../lib/api";
import { ConfigurationPanel } from "./ConfigurationPanel";
import { WorkflowPanel } from "./WorkflowPanel";
import { SharedServicesPanel } from "./SharedServicesPanel";
import { Link } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Column,
  DataTable,
  EmptyState,
  Field,
  Input,
  PageHeader,
  PermissionDeniedState,
  Select,
  Spinner,
  StatusPill,
} from "../shell/components/ui";
import { OverlayDialog } from "../shell/components/OverlayDialog";

type OrgUnit = {
  id: string;
  parentId: string | null;
  name: string;
  unitType: string;
  legalEntityId: string;
  isActive: boolean;
  deactivatedAt: string | null;
  deactivatedBy: string | null;
};
type LegalEntity = {
  id: string;
  name: string;
  registrationNo: string | null;
  isActive: boolean;
  deactivatedAt: string | null;
  deactivatedBy: string | null;
};
type UserRow = {
  id: string;
  email: string;
  fullName: string;
  status: string;
  deactivatedAt: string | null;
  deactivatedBy: string | null;
};
type AuditRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
};

type ResourceState<T> = {
  data: T[];
  loading: boolean;
  error: string | null;
  denied: boolean;
  sessionExpired: boolean;
};

function emptyResource<T>(loading = true): ResourceState<T> {
  return { data: [], loading, error: null, denied: false, sessionExpired: false };
}

/** A failed read must stay distinct from an empty list, and 401/403 must stay
 * distinct from each other and from a generic load error. */
function describeFailure<T>(error: unknown, fallback: string): ResourceState<T> {
  const status = error instanceof ApiError ? error.status : null;
  if (status === 403) return { data: [], loading: false, error: null, denied: true, sessionExpired: false };
  if (status === 401) {
    return { data: [], loading: false, error: "Your session has expired. Sign in again.", denied: false, sessionExpired: true };
  }
  return {
    data: [],
    loading: false,
    error: error instanceof ApiError ? error.message : fallback,
    denied: false,
    sessionExpired: false,
  };
}

export function DashboardPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const currentUserId = session!.userId;

  const [tenantName, setTenantName] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [orgUnitLabel, setOrgUnitLabel] = useState("Organization Units");
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  // Resource-specific states
  const [orgUnits, setOrgUnits] = useState<ResourceState<OrgUnit>>(emptyResource<OrgUnit>());
  const [legalEntities, setLegalEntities] = useState<ResourceState<LegalEntity>>(emptyResource<LegalEntity>());
  const [users, setUsers] = useState<ResourceState<UserRow>>(emptyResource<UserRow>());
  const [auditLog, setAuditLog] = useState<ResourceState<AuditRow>>(emptyResource<AuditRow>());
  const [userQuery, setUserQuery] = useState("");

  // Create OU dialog
  const [ouCreateOpen, setOuCreateOpen] = useState(false);
  const [ouCreatePending, setOuCreatePending] = useState(false);
  const [ouCreateError, setOuCreateError] = useState<string | null>(null);
  const ouCreateFormRef = useRef<HTMLFormElement>(null);
  const ouCreateButtonRef = useRef<HTMLButtonElement | null>(null);

  // Create LE dialog
  const [leCreateOpen, setLeCreateOpen] = useState(false);
  const [leCreatePending, setLeCreatePending] = useState(false);
  const [leCreateError, setLeCreateError] = useState<string | null>(null);
  const leCreateFormRef = useRef<HTMLFormElement>(null);
  const leCreateButtonRef = useRef<HTMLButtonElement | null>(null);

  // Detail dialogs
  const [selectedOu, setSelectedOu] = useState<OrgUnit | null>(null);
  const [selectedLe, setSelectedLe] = useState<LegalEntity | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  // Edit mode per detail dialog; both share `editPending` because only one
  // dialog can be open at a time.
  const [ouEditing, setOuEditing] = useState(false);
  const [leEditing, setLeEditing] = useState(false);
  const ouEditFormRef = useRef<HTMLFormElement>(null);
  const leEditFormRef = useRef<HTMLFormElement>(null);

  // Lifecycle action states
  const [lifecycleActionPending, setLifecycleActionPending] = useState(false);
  const [lifecycleActionError, setLifecycleActionError] = useState<string | null>(null);
  const [userDeleteConfirming, setUserDeleteConfirming] = useState(false);
  // True while the open detail dialog is in edit mode. Kept separate from
  // `lifecycleActionPending` so the Save button owns its own busy label
  // without also relabelling the activate/deactivate button beside it.
  const [editPending, setEditPending] = useState(false);

  const refreshGeneration = useRef(0);
  const lifetime = useRef(0);

  useEffect(() => {
    lifetime.current += 1;
    return () => {
      lifetime.current += 1;
    };
  }, [token]);

  const canCreateOrgUnit = permissions.includes("organization_unit.create");
  const canUpdateOrgUnit = permissions.includes("organization_unit.update");
  const canActivateOrgUnit = permissions.includes("organization_unit.activate");
  const canDeactivateOrgUnit = permissions.includes("organization_unit.deactivate");
  const canCreateLegalEntity = permissions.includes("legal_entity.create");
  const canUpdateLegalEntity = permissions.includes("legal_entity.update");
  const canActivateLegalEntity = permissions.includes("legal_entity.activate");
  const canDeactivateLegalEntity = permissions.includes("legal_entity.deactivate");
  const canActivateUser = permissions.includes("user.activate");
  const canDeactivateUser = permissions.includes("user.deactivate");
  const canDeleteUser = permissions.includes("user.delete");
  const canManageConfig = permissions.includes("config.manage");

  // Load all resources independently. A failed read never renders as empty
  // data, and a stale response never overwrites a newer one.
  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;

    setOrgUnits((prev) => ({ ...prev, loading: true, error: null, denied: false, sessionExpired: false }));
    setLegalEntities((prev) => ({ ...prev, loading: true, error: null, denied: false, sessionExpired: false }));
    setUsers((prev) => ({ ...prev, loading: true, error: null, denied: false, sessionExpired: false }));
    setAuditLog((prev) => ({ ...prev, loading: true, error: null, denied: false, sessionExpired: false }));

    // Tenant display metadata: only used for the header, so a failure here
    // degrades the header rather than blocking the panels below it.
    void Promise.all([api.tenant(token), api.me(token), api.configTerminology(token)])
      .then(([tenant, me, terminology]) => {
        if (refreshGeneration.current !== generation) return;
        setTenantName(tenant.name);
        setPermissions(me.permissions);
        const orgUnitTerm = terminology.find((t) => t.code === "organization_unit.label");
        if (orgUnitTerm) setOrgUnitLabel(`${orgUnitTerm.value}s`);
      })
      .catch(() => {
        if (refreshGeneration.current !== generation) return;
        setMessage({ type: "error", text: "Tenant and permission details could not be loaded. Controls below may be incomplete." });
      });

    const [orgUnitResult, legalEntityResult, userResult, auditResult] = await Promise.allSettled([
      api.organizationUnits(token),
      api.legalEntities(token),
      api.users(token),
      api.recentAuditLog(token),
    ]);
    if (refreshGeneration.current !== generation) return;

    setOrgUnits(
      orgUnitResult.status === "fulfilled"
        ? { data: orgUnitResult.value, loading: false, error: null, denied: false, sessionExpired: false }
        : describeFailure<OrgUnit>(orgUnitResult.reason, "Failed to load organization units"),
    );
    setLegalEntities(
      legalEntityResult.status === "fulfilled"
        ? { data: legalEntityResult.value, loading: false, error: null, denied: false, sessionExpired: false }
        : describeFailure<LegalEntity>(legalEntityResult.reason, "Failed to load legal entities"),
    );
    setUsers(
      userResult.status === "fulfilled"
        ? { data: userResult.value, loading: false, error: null, denied: false, sessionExpired: false }
        : describeFailure<UserRow>(userResult.reason, "Failed to load users"),
    );
    setAuditLog(
      auditResult.status === "fulfilled"
        ? { data: auditResult.value, loading: false, error: null, denied: false, sessionExpired: false }
        : describeFailure<AuditRow>(auditResult.reason, "Failed to load audit log"),
    );
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Organization Unit handlers
  const handleOuCreate = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (ouCreatePending || !canCreateOrgUnit || !ouCreateFormRef.current) return;
      const form = new FormData(ouCreateFormRef.current);
      const name = String(form.get("name") ?? "").trim();
      const legalEntityId = String(form.get("legalEntityId") ?? "");
      const parentId = form.get("parentId") ? String(form.get("parentId")) : null;
      const unitType = String(form.get("unitType") ?? "").trim() || "Organization Unit";
      if (!name || !legalEntityId) {
        setOuCreateError("Name and legal entity are required.");
        return;
      }
      const life = lifetime.current;
      setOuCreateError(null);
      setOuCreatePending(true);
      try {
        await api.createOrganizationUnit(token, { legalEntityId, parentId, name, unitType });
        if (lifetime.current !== life) return;
        setMessage({ type: "success", text: "Organization Unit created." });
        setOuCreateOpen(false);
        ouCreateFormRef.current?.reset();
        await refresh();
      } catch (err) {
        if (lifetime.current !== life) return;
        setOuCreateError(err instanceof ApiError ? err.message : "Failed to create organization unit");
      } finally {
        if (lifetime.current === life) setOuCreatePending(false);
      }
    },
    [token, refresh, ouCreatePending, canCreateOrgUnit],
  );

  const closeOuCreate = useCallback(() => {
    if (ouCreatePending) return;
    setOuCreateOpen(false);
    setOuCreateError(null);
  }, [ouCreatePending]);

  // Legal Entity handlers
  const handleLeCreate = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (leCreatePending || !canCreateLegalEntity || !leCreateFormRef.current) return;
      const form = new FormData(leCreateFormRef.current);
      const name = String(form.get("name") ?? "").trim();
      const registrationNo = form.get("registrationNo") ? String(form.get("registrationNo")) : null;
      if (!name) {
        setLeCreateError("Name is required.");
        return;
      }
      const life = lifetime.current;
      setLeCreateError(null);
      setLeCreatePending(true);
      try {
        await api.createLegalEntity(token, { name, registrationNo });
        if (lifetime.current !== life) return;
        setMessage({ type: "success", text: "Legal Entity created." });
        setLeCreateOpen(false);
        leCreateFormRef.current?.reset();
        await refresh();
      } catch (err) {
        if (lifetime.current !== life) return;
        setLeCreateError(err instanceof ApiError ? err.message : "Failed to create legal entity");
      } finally {
        if (lifetime.current === life) setLeCreatePending(false);
      }
    },
    [token, refresh, leCreatePending, canCreateLegalEntity],
  );

  const closeLeCreate = useCallback(() => {
    if (leCreatePending) return;
    setLeCreateOpen(false);
    setLeCreateError(null);
  }, [leCreatePending]);

  // Lifecycle actions (activate/deactivate/delete)
  const handleOuLifecycleAction = useCallback(
    async (id: string, action: "activate" | "deactivate") => {
      if (lifecycleActionPending) return;
      const life = lifetime.current;
      setLifecycleActionError(null);
      setLifecycleActionPending(true);
      try {
        if (action === "activate") {
          await api.activateOrganizationUnit(token, id);
        } else {
          await api.deactivateOrganizationUnit(token, id);
        }
        if (lifetime.current !== life) return;
        setMessage({
          type: "success",
          text: `Organization Unit ${action === "activate" ? "activated" : "deactivated"}.`,
        });
        setSelectedOu(null);
        await refresh();
      } catch (err) {
        if (lifetime.current !== life) return;
        setLifecycleActionError(err instanceof ApiError ? err.message : `Failed to ${action} organization unit`);
      } finally {
        if (lifetime.current === life) setLifecycleActionPending(false);
      }
    },
    [token, refresh, lifecycleActionPending],
  );

  const handleLeLifecycleAction = useCallback(
    async (id: string, action: "activate" | "deactivate") => {
      if (lifecycleActionPending) return;
      const life = lifetime.current;
      setLifecycleActionError(null);
      setLifecycleActionPending(true);
      try {
        if (action === "activate") {
          await api.activateLegalEntity(token, id);
        } else {
          await api.deactivateLegalEntity(token, id);
        }
        if (lifetime.current !== life) return;
        setMessage({
          type: "success",
          text: `Legal Entity ${action === "activate" ? "activated" : "deactivated"}.`,
        });
        setSelectedLe(null);
        await refresh();
      } catch (err) {
        if (lifetime.current !== life) return;
        setLifecycleActionError(err instanceof ApiError ? err.message : `Failed to ${action} legal entity`);
      } finally {
        if (lifetime.current === life) setLifecycleActionPending(false);
      }
    },
    [token, refresh, lifecycleActionPending],
  );

  // OU / LE rename. The backend update schemas require `name` and overwrite
  // the field's sibling unconditionally (the OU repository writes
  // `unit_type = $2` with a default fallback, the LE repository writes
  // `registration_no = $2`), so a rename must send the sibling too or it
  // would silently reset it. Both forms prefill from the selected record,
  // and an emptied OU type falls back to the current value rather than
  // silently reverting to the "Organization Unit" default.
  const handleOuEdit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (editPending || !selectedOu || !canUpdateOrgUnit || !ouEditFormRef.current) return;
      const form = new FormData(ouEditFormRef.current);
      const name = String(form.get("name") ?? "").trim();
      const unitType = String(form.get("unitType") ?? "").trim() || selectedOu.unitType;
      if (!name) {
        setLifecycleActionError("Organization Unit name is required.");
        return;
      }
      const life = lifetime.current;
      const id = selectedOu.id;
      setLifecycleActionError(null);
      setEditPending(true);
      try {
        const updated = await api.updateOrganizationUnit(token, id, { name, unitType });
        if (lifetime.current !== life) return;
        setMessage({ type: "success", text: "Organization Unit updated." });
        setSelectedOu((prev) =>
          prev && prev.id === id
            ? {
                ...prev,
                name: updated.name,
                unitType: updated.unitType,
                isActive: updated.isActive,
                deactivatedAt: updated.deactivatedAt,
                deactivatedBy: updated.deactivatedBy,
              }
            : prev,
        );
        setOuEditing(false);
        await refresh();
      } catch (err) {
        if (lifetime.current !== life) return;
        setLifecycleActionError(
          err instanceof ApiError ? err.message : "Failed to update organization unit",
        );
      } finally {
        if (lifetime.current === life) setEditPending(false);
      }
    },
    [token, refresh, editPending, selectedOu, canUpdateOrgUnit],
  );

  const handleLeEdit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (editPending || !selectedLe || !canUpdateLegalEntity || !leEditFormRef.current) return;
      const form = new FormData(leEditFormRef.current);
      const name = String(form.get("name") ?? "").trim();
      const registrationNo = String(form.get("registrationNo") ?? "").trim() || null;
      if (!name) {
        setLifecycleActionError("Legal Entity name is required.");
        return;
      }
      const life = lifetime.current;
      const id = selectedLe.id;
      setLifecycleActionError(null);
      setEditPending(true);
      try {
        const updated = await api.updateLegalEntity(token, id, { name, registrationNo });
        if (lifetime.current !== life) return;
        setMessage({ type: "success", text: "Legal Entity updated." });
        setSelectedLe((prev) =>
          prev && prev.id === id
            ? {
                ...prev,
                name: updated.name,
                registrationNo: updated.registrationNo,
                isActive: updated.isActive,
                deactivatedAt: updated.deactivatedAt,
                deactivatedBy: updated.deactivatedBy,
              }
            : prev,
        );
        setLeEditing(false);
        await refresh();
      } catch (err) {
        if (lifetime.current !== life) return;
        setLifecycleActionError(
          err instanceof ApiError ? err.message : "Failed to update legal entity",
        );
      } finally {
        if (lifetime.current === life) setEditPending(false);
      }
    },
    [token, refresh, editPending, selectedLe, canUpdateLegalEntity],
  );

  const handleUserLifecycleAction = useCallback(
    async (id: string, action: "activate" | "deactivate" | "delete") => {
      if (lifecycleActionPending) return;
      const life = lifetime.current;
      setLifecycleActionError(null);
      setLifecycleActionPending(true);
      try {
        if (action === "activate") {
          await api.activateUser(token, id);
        } else if (action === "deactivate") {
          await api.deactivateUser(token, id);
        } else {
          await api.deleteUser(token, id);
        }
        if (lifetime.current !== life) return;
        const actionLabel = action === "activate" ? "activated" : action === "deactivate" ? "deactivated" : "deleted";
        setMessage({ type: "success", text: `User ${actionLabel}.` });
        setSelectedUser(null);
        setUserDeleteConfirming(false);
        await refresh();
      } catch (err) {
        if (lifetime.current !== life) return;
        setLifecycleActionError(err instanceof ApiError ? err.message : `Failed to ${action} user`);
      } finally {
        if (lifetime.current === life) setLifecycleActionPending(false);
      }
    },
    [token, refresh, lifecycleActionPending],
  );

  // A detail dialog never closes mid-action: the row it describes is being
  // mutated, so closing early would hide the outcome of the call in flight.
  const closeOuDetail = useCallback(() => {
    if (lifecycleActionPending || editPending) return;
    setSelectedOu(null);
    setLifecycleActionError(null);
    setOuEditing(false);
  }, [lifecycleActionPending, editPending]);

  const closeLeDetail = useCallback(() => {
    if (lifecycleActionPending || editPending) return;
    setSelectedLe(null);
    setLifecycleActionError(null);
    setLeEditing(false);
  }, [lifecycleActionPending, editPending]);

  const closeUserDetail = useCallback(() => {
    if (lifecycleActionPending) return;
    setSelectedUser(null);
    setLifecycleActionError(null);
    setUserDeleteConfirming(false);
  }, [lifecycleActionPending]);

  // Helpers for OU detail
  const getOuParentName = (ou: OrgUnit): string => {
    if (!ou.parentId) return "(root)";
    const parent = orgUnits.data.find((u) => u.id === ou.parentId);
    return parent?.name ?? "(unavailable organization unit)";
  };

  const getLeName = (id: string): string => {
    const le = legalEntities.data.find((l) => l.id === id);
    return le?.name ?? "(unavailable legal entity)";
  };

  const visibleUsers = useMemo(() => {
    const query = userQuery.trim().toLocaleLowerCase();
    if (!query) return users.data;
    return users.data.filter((user) => `${user.fullName} ${user.email} ${user.status}`.toLocaleLowerCase().includes(query));
  }, [users.data, userQuery]);

  // Render functions
  const renderOrgUnitsSection = () => {
    if (orgUnits.denied) {
      return (
        <PermissionDeniedState
          permission="organization_unit.read"
          action={
            <Button variant="secondary" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        />
      );
    }

    if (orgUnits.error) {
      return (
        <Card>
          <Alert tone="error">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{orgUnits.error}</span>
              {!orgUnits.sessionExpired && (
                <Button variant="secondary" onClick={() => void refresh()}>
                  Retry
                </Button>
              )}
            </div>
          </Alert>
        </Card>
      );
    }

    if (orgUnits.loading) {
      return <Spinner label="Loading organization units…" />;
    }

    const ouColumns: Column<OrgUnit>[] = [
      {
        header: "Name",
        cell: (ou) => <span className="font-medium">{ou.name}</span>,
        mobileRole: "title",
      },
      {
        header: "Type",
        cell: (ou) => <span className="text-xs text-slate-500">{ou.unitType}</span>,
      },
      {
        header: "Parent",
        cell: (ou) => <span className="text-sm">{getOuParentName(ou)}</span>,
      },
      {
        header: "Legal Entity",
        cell: (ou) => <span className="text-sm">{getLeName(ou.legalEntityId)}</span>,
      },
      {
        header: "Actions",
        cell: (ou) => (
          <Button
            variant="secondary"
            className="w-full sm:min-h-[44px] sm:w-auto"
            onClick={() => {
              setLifecycleActionError(null);
              setOuEditing(false);
              setSelectedOu(ou);
            }}
          >
            Details
          </Button>
        ),
        className: "text-right",
      },
    ];

    return (
      <DataTable
        columns={ouColumns}
        rows={orgUnits.data}
        keyOf={(ou) => ou.id}
        mobileBreakpoint="md"
        empty={
          <EmptyState
            title="No organization units"
            description="No organization units were found for this tenant."
            action={
              canCreateOrgUnit && legalEntitiesAvailable ? (
                <Button
                  variant="secondary"
                  onClick={(event) => {
                    ouCreateButtonRef.current = event.currentTarget;
                    setOuCreateOpen(true);
                  }}
                >
                  Create your first unit
                </Button>
              ) : undefined
            }
          />
        }
      />
    );
  };

  const renderLegalEntitiesSection = () => {
    if (legalEntities.denied) {
      return (
        <PermissionDeniedState
          permission="legal_entity.read"
          action={
            <Button variant="secondary" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        />
      );
    }

    if (legalEntities.error) {
      return (
        <Card>
          <Alert tone="error">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{legalEntities.error}</span>
              {!legalEntities.sessionExpired && (
                <Button variant="secondary" onClick={() => void refresh()}>
                  Retry
                </Button>
              )}
            </div>
          </Alert>
        </Card>
      );
    }

    if (legalEntities.loading) {
      return <Spinner label="Loading legal entities…" />;
    }

    const leColumns: Column<LegalEntity>[] = [
      {
        header: "Name",
        cell: (le) => <span className="font-medium">{le.name}</span>,
        mobileRole: "title",
      },
      {
        header: "Registration No.",
        cell: (le) => (
          <span className="font-mono text-xs">{le.registrationNo ? le.registrationNo : "(none)"}</span>
        ),
      },
      {
        header: "Actions",
        cell: (le) => (
          <Button
            variant="secondary"
            className="w-full sm:min-h-[44px] sm:w-auto"
            onClick={() => {
              setLifecycleActionError(null);
              setLeEditing(false);
              setSelectedLe(le);
            }}
          >
            Details
          </Button>
        ),
        className: "text-right",
      },
    ];

    return (
      <DataTable
        columns={leColumns}
        rows={legalEntities.data}
        keyOf={(le) => le.id}
        mobileBreakpoint="md"
        empty={
          <EmptyState
            title="No legal entities"
            description="No legal entities were found for this tenant."
            action={
              canCreateLegalEntity ? (
                <Button
                  variant="secondary"
                  onClick={(event) => {
                    leCreateButtonRef.current = event.currentTarget;
                    setLeCreateOpen(true);
                  }}
                >
                  Create your first entity
                </Button>
              ) : undefined
            }
          />
        }
      />
    );
  };

  const renderUsersSection = () => {
    if (users.denied) {
      return (
        <PermissionDeniedState
          permission="user.read"
          action={
            <Button variant="secondary" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        />
      );
    }

    if (users.error) {
      return (
        <Card>
          <Alert tone="error">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{users.error}</span>
              {!users.sessionExpired && (
                <Button variant="secondary" onClick={() => void refresh()}>
                  Retry
                </Button>
              )}
            </div>
          </Alert>
        </Card>
      );
    }

    if (users.loading) {
      return <Spinner label="Loading users…" />;
    }

    const userColumns: Column<UserRow>[] = [
      { header: "Name", mobileRole: "title", cell: (u) => <span className="font-medium">{u.fullName}</span> },
      { header: "Email", mobileRole: "detail", cell: (u) => u.email },
      {
        header: "Status",
        mobileRole: "status",
        cell: (u) => <StatusPill tone={u.status === "active" ? "success" : "neutral"}>{u.status}</StatusPill>,
      },
      {
        header: "Actions",
        cell: (u) => (
          <Button
            variant="secondary"
            className="w-full sm:min-h-[44px] sm:w-auto"
            onClick={() => {
              setLifecycleActionError(null);
              setUserDeleteConfirming(false);
              setSelectedUser(u);
            }}
          >
            Lifecycle
          </Button>
        ),
        className: "text-right",
      },
    ];

    return (
      <>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="sm:max-w-xs sm:flex-1">
            <Field label="Search users">
              <Input
                type="search"
                placeholder="Search name, email, or status"
                value={userQuery}
                onChange={(event) => setUserQuery(event.target.value)}
                autoComplete="off"
              />
            </Field>
          </div>
          <p className="text-xs text-slate-500">
            Showing {visibleUsers.length} of {users.data.length} loaded user{users.data.length !== 1 ? "s" : ""}. Search is limited to this loaded list.
          </p>
        </div>
        <DataTable
          columns={userColumns}
          rows={visibleUsers}
          keyOf={(u) => u.id}
          mobileBreakpoint="md"
          empty={
            <EmptyState
              title={users.data.length === 0 ? "No users" : "No matching users"}
              description={
                users.data.length === 0
                  ? "No users were found for this tenant."
                  : "Try a different search term or clear the filter."
              }
            />
          }
        />
      </>
    );
  };

  const renderAuditSection = () => {
    if (auditLog.denied) {
      return (
        <PermissionDeniedState
          permission="audit_log.read"
          action={
            <Button variant="secondary" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        />
      );
    }

    if (auditLog.error) {
      return (
        <Card>
          <Alert tone="error">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{auditLog.error}</span>
              {!auditLog.sessionExpired && (
                <Button variant="secondary" onClick={() => void refresh()}>
                  Retry
                </Button>
              )}
            </div>
          </Alert>
        </Card>
      );
    }

    if (auditLog.loading) {
      return <Spinner label="Loading audit log…" />;
    }

    const auditColumns: Column<AuditRow>[] = [
      { header: "Action", mobileRole: "title", cell: (entry) => <span className="font-medium">{entry.action}</span> },
      { header: "Entity", mobileRole: "detail", cell: (entry) => entry.entityType },
      { header: "Entity ID", cell: (entry) => (entry.entityId ? `${entry.entityId.slice(0, 8)}…` : "—") },
      { header: "Occurred", mobileRole: "status", cell: (entry) => new Date(entry.createdAt).toLocaleString() },
    ];

    return (
      <DataTable
        columns={auditColumns}
        rows={auditLog.data}
        keyOf={(entry) => entry.id}
        mobileBreakpoint="md"
        empty={<EmptyState title="No activity recorded yet" description="No audit entries are available for this tenant." />}
      />
    );
  };

  const legalEntitiesAvailable = legalEntities.data.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Administration"
        subtitle={
          tenantName
            ? `${tenantName} — ${
                permissions.length === 0
                  ? "no permissions"
                  : `${permissions.length} permission${permissions.length !== 1 ? "s" : ""}`
              }`
            : "Organization, users, configuration, and shared services."
        }
        actions={
          permissions.includes("complaint.configure") ? (
            <Link to="/administration/complaints">
              <Button variant="secondary">Complaint Configuration</Button>
            </Link>
          ) : undefined
        }
      />

      {message && (
        <Alert tone={message.type === "error" ? "error" : "success"}>
          {message.text}
        </Alert>
      )}

      <div className="space-y-6">
        {/* Organization Units */}
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">{orgUnitLabel}</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {orgUnits.loading ? "Loading…" : `${orgUnits.data.length} unit${orgUnits.data.length !== 1 ? "s" : ""}`}
              </p>
            </div>
            {canCreateOrgUnit && (
              <Button
                variant="primary"
                disabled={!legalEntitiesAvailable}
                title={legalEntitiesAvailable ? undefined : "A legal entity is required before creating an organization unit."}
                onClick={(event) => {
                  ouCreateButtonRef.current = event.currentTarget;
                  setOuCreateOpen(true);
                }}
              >
                Create
              </Button>
            )}
          </div>
          {canCreateOrgUnit && !legalEntitiesAvailable && !legalEntities.loading && !legalEntities.denied && !legalEntities.error && (
            <p className="mb-3 text-xs text-slate-500">
              Create a Legal Entity first — an Organization Unit must belong to one.
            </p>
          )}
          {renderOrgUnitsSection()}
        </Card>

        {/* Legal Entities */}
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Legal Entities</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {legalEntities.loading ? "Loading…" : `${legalEntities.data.length} entit${legalEntities.data.length !== 1 ? "ies" : "y"}`}
              </p>
            </div>
            {canCreateLegalEntity && (
              <Button
                variant="primary"
                onClick={(event) => {
                  leCreateButtonRef.current = event.currentTarget;
                  setLeCreateOpen(true);
                }}
              >
                Create
              </Button>
            )}
          </div>
          {renderLegalEntitiesSection()}
        </Card>

        {/* Users */}
        <Card>
          <h2 className="mb-4 text-base font-semibold text-slate-900">Users</h2>
          {renderUsersSection()}
        </Card>

        {/* Audit Trail */}
        <Card>
          <h2 className="mb-4 text-base font-semibold text-slate-900">Audit Trail (recent)</h2>
          {renderAuditSection()}
        </Card>
      </div>

      {/* Create OU Dialog */}
      {canCreateOrgUnit && (
        <OverlayDialog
          open={ouCreateOpen}
          title="Create Organization Unit"
          description="Add a new organization unit to this tenant."
          pending={ouCreatePending}
          onClose={closeOuCreate}
          restoreFocusRef={ouCreateButtonRef}
          footer={
            <>
              <Button variant="secondary" onClick={closeOuCreate} disabled={ouCreatePending}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => ouCreateFormRef.current?.requestSubmit()}
                disabled={ouCreatePending}
              >
                {ouCreatePending ? "Creating…" : "Create"}
              </Button>
            </>
          }
        >
          <form ref={ouCreateFormRef} onSubmit={handleOuCreate} className="space-y-4">
            {ouCreateError && <Alert tone="error">{ouCreateError}</Alert>}

            <Field label="Legal entity" required hint="Required — an Organization Unit always belongs to a Legal Entity.">
              <Select name="legalEntityId" required disabled={ouCreatePending || !legalEntitiesAvailable}>
                <option value="">{legalEntitiesAvailable ? "Select a legal entity…" : "No legal entities available"}</option>
                {legalEntities.data.map((le) => (
                  <option key={le.id} value={le.id}>
                    {le.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Parent organization unit" hint="Leave as root if this unit sits at the top of the hierarchy.">
              <Select name="parentId" disabled={ouCreatePending}>
                <option value="">(root — no parent)</option>
                {orgUnits.data.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Organization unit name" required>
              <Input
                name="name"
                placeholder="Name"
                required
                disabled={ouCreatePending}
              />
            </Field>

            <Field label="Organization unit type">
              <Input
                name="unitType"
                placeholder="Type (e.g. Branch, Site)"
                disabled={ouCreatePending}
              />
            </Field>
          </form>
        </OverlayDialog>
      )}

      {/* Create LE Dialog */}
      {canCreateLegalEntity && (
        <OverlayDialog
          open={leCreateOpen}
          title="Create Legal Entity"
          description="Add a new legal entity to this tenant."
          pending={leCreatePending}
          onClose={closeLeCreate}
          restoreFocusRef={leCreateButtonRef}
          footer={
            <>
              <Button variant="secondary" onClick={closeLeCreate} disabled={leCreatePending}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => leCreateFormRef.current?.requestSubmit()}
                disabled={leCreatePending}
              >
                {leCreatePending ? "Creating…" : "Create"}
              </Button>
            </>
          }
        >
          <form ref={leCreateFormRef} onSubmit={handleLeCreate} className="space-y-4">
            {leCreateError && <Alert tone="error">{leCreateError}</Alert>}

            <Field label="Legal entity name" required>
              <Input
                name="name"
                placeholder="Name"
                required
                disabled={leCreatePending}
              />
            </Field>

            <Field label="Registration number">
              <Input
                name="registrationNo"
                placeholder="Registration number (optional)"
                disabled={leCreatePending}
              />
            </Field>
          </form>
        </OverlayDialog>
      )}

      {/* OU Detail Dialog */}
      <OverlayDialog
        open={selectedOu !== null}
        title={selectedOu ? `${selectedOu.name}` : "Organization Unit"}
        description={
          selectedOu
            ? ouEditing
              ? "Edit this organization unit. Parent and legal entity are fixed after creation."
              : `Details for this organization unit.`
            : undefined
        }
        pending={lifecycleActionPending || editPending}
        onClose={closeOuDetail}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={closeOuDetail}
              disabled={lifecycleActionPending || editPending}
            >
              {ouEditing ? "Cancel" : "Close"}
            </Button>
            {selectedOu && ouEditing && (
              <Button
                variant="primary"
                onClick={() => ouEditFormRef.current?.requestSubmit()}
                disabled={editPending}
              >
                {editPending ? "Saving…" : "Save changes"}
              </Button>
            )}
            {selectedOu && !ouEditing && canUpdateOrgUnit && (
              <Button variant="secondary" onClick={() => setOuEditing(true)}>
                Edit
              </Button>
            )}
            {selectedOu && !ouEditing && (selectedOu.isActive ? canDeactivateOrgUnit : canActivateOrgUnit) && (
              <Button
                variant={selectedOu.isActive ? "secondary" : "primary"}
                onClick={() => void handleOuLifecycleAction(selectedOu.id, selectedOu.isActive ? "deactivate" : "activate")}
                disabled={lifecycleActionPending}
              >
                {lifecycleActionPending
                  ? "Saving…"
                  : selectedOu.isActive
                    ? "Deactivate"
                    : "Activate"}
              </Button>
            )}
          </>
        }
      >
        {selectedOu && (
          <div className="space-y-4 break-words">
            {lifecycleActionError && <Alert tone="error">{lifecycleActionError}</Alert>}
            {ouEditing ? (
              <form ref={ouEditFormRef} onSubmit={handleOuEdit} className="space-y-4">
                <Field label="Organization unit name" required>
                  <Input
                    name="name"
                    placeholder="Name"
                    required
                    defaultValue={selectedOu.name}
                    disabled={editPending}
                  />
                </Field>
                <Field
                  label="Organization unit type"
                  hint="Leave unchanged to keep the current type."
                >
                  <Input
                    name="unitType"
                    placeholder="Type (e.g. Branch, Site)"
                    defaultValue={selectedOu.unitType}
                    disabled={editPending}
                  />
                </Field>
                <p className="text-xs text-slate-500">
                  Parent and legal entity cannot be changed after creation. Use activate or
                  deactivate to change availability instead.
                </p>
              </form>
            ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="space-y-3 text-sm">
                <div>
                  <span className="font-medium text-slate-700">Name:</span>
                  <span className="ml-2 text-slate-900">{selectedOu.name}</span>
                </div>
                <div>
                  <span className="font-medium text-slate-700">Type:</span>
                  <span className="ml-2 text-slate-900">{selectedOu.unitType}</span>
                </div>
                <div>
                  <span className="font-medium text-slate-700">Parent:</span>
                  <span className="ml-2 text-slate-900">{getOuParentName(selectedOu)}</span>
                </div>
                <div>
                  <span className="font-medium text-slate-700">Legal Entity:</span>
                  <span className="ml-2 text-slate-900">{getLeName(selectedOu.legalEntityId)}</span>
                </div>
                <div>
                  <span className="font-medium text-slate-700">Status:</span>
                  <span className="ml-2">
                    <StatusPill tone={selectedOu.isActive ? "success" : "neutral"}>
                      {selectedOu.isActive ? "Active" : "Inactive"}
                    </StatusPill>
                  </span>
                </div>
                {!selectedOu.isActive && selectedOu.deactivatedAt && (
                  <div>
                    <span className="font-medium text-slate-700">Deactivated:</span>
                    <span className="ml-2 text-slate-900">{new Date(selectedOu.deactivatedAt).toLocaleString()}</span>
                  </div>
                )}
                {!selectedOu.isActive && selectedOu.deactivatedBy && (
                  <div>
                    <span className="font-medium text-slate-700">Deactivated by:</span>
                    <code className="ml-2 font-mono text-xs text-slate-600">{selectedOu.deactivatedBy}</code>
                  </div>
                )}
                <div>
                  <span className="font-medium text-slate-700">ID:</span>
                  <code className="ml-2 font-mono text-xs text-slate-600">{selectedOu.id}</code>
                </div>
              </div>
            </div>
            )}
          </div>
        )}
      </OverlayDialog>

      {/* LE Detail Dialog */}
      <OverlayDialog
        open={selectedLe !== null}
        title={selectedLe ? `${selectedLe.name}` : "Legal Entity"}
        description={
          selectedLe
            ? leEditing
              ? "Edit this legal entity."
              : `Details for this legal entity.`
            : undefined
        }
        pending={lifecycleActionPending || editPending}
        onClose={closeLeDetail}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={closeLeDetail}
              disabled={lifecycleActionPending || editPending}
            >
              {leEditing ? "Cancel" : "Close"}
            </Button>
            {selectedLe && leEditing && (
              <Button
                variant="primary"
                onClick={() => leEditFormRef.current?.requestSubmit()}
                disabled={editPending}
              >
                {editPending ? "Saving…" : "Save changes"}
              </Button>
            )}
            {selectedLe && !leEditing && canUpdateLegalEntity && (
              <Button variant="secondary" onClick={() => setLeEditing(true)}>
                Edit
              </Button>
            )}
            {selectedLe && !leEditing && (selectedLe.isActive ? canDeactivateLegalEntity : canActivateLegalEntity) && (
              <Button
                variant={selectedLe.isActive ? "secondary" : "primary"}
                onClick={() => void handleLeLifecycleAction(selectedLe.id, selectedLe.isActive ? "deactivate" : "activate")}
                disabled={lifecycleActionPending}
              >
                {lifecycleActionPending
                  ? "Saving…"
                  : selectedLe.isActive
                    ? "Deactivate"
                    : "Activate"}
              </Button>
            )}
          </>
        }
      >
        {selectedLe && (
          <div className="space-y-4 break-words">
            {lifecycleActionError && <Alert tone="error">{lifecycleActionError}</Alert>}
            {leEditing ? (
              <form ref={leEditFormRef} onSubmit={handleLeEdit} className="space-y-4">
                <Field label="Legal entity name" required>
                  <Input
                    name="name"
                    placeholder="Name"
                    required
                    defaultValue={selectedLe.name}
                    disabled={editPending}
                  />
                </Field>
                <Field
                  label="Registration number"
                  hint="Leave empty to clear the registration number."
                >
                  <Input
                    name="registrationNo"
                    placeholder="Registration number (optional)"
                    defaultValue={selectedLe.registrationNo ?? ""}
                    disabled={editPending}
                  />
                </Field>
              </form>
            ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="space-y-3 text-sm">
                <div>
                  <span className="font-medium text-slate-700">Name:</span>
                  <span className="ml-2 text-slate-900">{selectedLe.name}</span>
                </div>
                {selectedLe.registrationNo && (
                  <div>
                    <span className="font-medium text-slate-700">Registration No.:</span>
                    <span className="ml-2 font-mono text-slate-900">{selectedLe.registrationNo}</span>
                  </div>
                )}
                <div>
                  <span className="font-medium text-slate-700">Status:</span>
                  <span className="ml-2">
                    <StatusPill tone={selectedLe.isActive ? "success" : "neutral"}>
                      {selectedLe.isActive ? "Active" : "Inactive"}
                    </StatusPill>
                  </span>
                </div>
                {!selectedLe.isActive && selectedLe.deactivatedAt && (
                  <div>
                    <span className="font-medium text-slate-700">Deactivated:</span>
                    <span className="ml-2 text-slate-900">{new Date(selectedLe.deactivatedAt).toLocaleString()}</span>
                  </div>
                )}
                {!selectedLe.isActive && selectedLe.deactivatedBy && (
                  <div>
                    <span className="font-medium text-slate-700">Deactivated by:</span>
                    <code className="ml-2 font-mono text-xs text-slate-600">{selectedLe.deactivatedBy}</code>
                  </div>
                )}
                <div>
                  <span className="font-medium text-slate-700">ID:</span>
                  <code className="ml-2 font-mono text-xs text-slate-600">{selectedLe.id}</code>
                </div>
              </div>
            </div>
            )}
          </div>
        )}
      </OverlayDialog>

      {/* User Lifecycle Dialog */}
      <OverlayDialog
        open={selectedUser !== null}
        title={selectedUser ? selectedUser.fullName : "User lifecycle"}
        description={selectedUser ? `Manage status for ${selectedUser.email}.` : undefined}
        pending={lifecycleActionPending}
        onClose={closeUserDetail}
        footer={
          <>
            <Button variant="secondary" onClick={closeUserDetail} disabled={lifecycleActionPending}>
              Close
            </Button>
            {selectedUser && selectedUser.id !== currentUserId && (
              <>
                {(selectedUser.status === "active" ? canDeactivateUser : canActivateUser) && (
                  <Button
                    variant={selectedUser.status === "active" ? "secondary" : "primary"}
                    onClick={() =>
                      void handleUserLifecycleAction(
                        selectedUser.id,
                        selectedUser.status === "active" ? "deactivate" : "activate",
                      )
                    }
                    disabled={lifecycleActionPending}
                  >
                    {lifecycleActionPending
                      ? "Saving…"
                      : selectedUser.status === "active"
                        ? "Deactivate"
                        : "Activate"}
                  </Button>
                )}
                {canDeleteUser && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      userDeleteConfirming
                        ? void handleUserLifecycleAction(selectedUser.id, "delete")
                        : setUserDeleteConfirming(true)
                    }
                    disabled={lifecycleActionPending}
                  >
                    {lifecycleActionPending ? "Saving…" : userDeleteConfirming ? "Confirm delete" : "Delete"}
                  </Button>
                )}
              </>
            )}
          </>
        }
      >
        {selectedUser && (
          <div className="space-y-4 break-words">
            {lifecycleActionError && <Alert tone="error">{lifecycleActionError}</Alert>}
            {userDeleteConfirming && (
              <Alert tone="warning">
                <p>Delete {selectedUser.email}? This removes sign-in access and hides the user from this list. Records and audit history are retained. This screen cannot restore a deleted user.</p>
                <Button
                  variant="secondary"
                  className="mt-2"
                  disabled={lifecycleActionPending}
                  onClick={() => setUserDeleteConfirming(false)}
                >
                  Cancel deletion
                </Button>
              </Alert>
            )}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="space-y-3 text-sm">
                <div>
                  <span className="font-medium text-slate-700">Name:</span>
                  <span className="ml-2 text-slate-900">{selectedUser.fullName}</span>
                </div>
                <div>
                  <span className="font-medium text-slate-700">Email:</span>
                  <span className="ml-2 text-slate-900">{selectedUser.email}</span>
                </div>
                <div>
                  <span className="font-medium text-slate-700">Status:</span>
                  <span className="ml-2">
                    <StatusPill tone={selectedUser.status === "active" ? "success" : "neutral"}>
                      {selectedUser.status}
                    </StatusPill>
                  </span>
                </div>
                {selectedUser.deactivatedAt && (
                  <div>
                    <span className="font-medium text-slate-700">Deactivated:</span>
                    <span className="ml-2 text-slate-900">{new Date(selectedUser.deactivatedAt).toLocaleString()}</span>
                  </div>
                )}
                {selectedUser.deactivatedBy && (
                  <div>
                    <span className="font-medium text-slate-700">Deactivated by:</span>
                    <code className="ml-2 font-mono text-xs text-slate-600">{selectedUser.deactivatedBy}</code>
                  </div>
                )}
                {selectedUser.id === currentUserId && (
                  <Alert tone="info">You cannot deactivate or delete your own account.</Alert>
                )}
                <div>
                  <span className="font-medium text-slate-700">ID:</span>
                  <code className="ml-2 font-mono text-xs text-slate-600">{selectedUser.id}</code>
                </div>
              </div>
            </div>
          </div>
        )}
      </OverlayDialog>

      <ConfigurationPanel
        token={token}
        orgUnits={orgUnits.data}
        canManage={canManageConfig}
        onMessage={setMessage}
      />

      <WorkflowPanel
        token={token}
        orgUnits={orgUnits.data}
        canStart={permissions.includes("workflow.instance.start")}
        canAct={permissions.includes("workflow.instance.act")}
        canManage={permissions.includes("workflow.instance.manage")}
        onMessage={setMessage}
      />

      <SharedServicesPanel
        token={token}
        canManageDocuments={permissions.includes("document.manage")}
        canManageScheduler={permissions.includes("scheduler.manage")}
        canReadIntegration={permissions.includes("integration.read")}
        canManageIntegration={permissions.includes("integration.manage")}
        canReadObservability={permissions.includes("observability.read")}
        onMessage={setMessage}
      />
    </div>
  );
}
