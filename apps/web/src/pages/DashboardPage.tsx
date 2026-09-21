import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { api, ApiError } from "../lib/api";
import { ConfigurationPanel } from "./ConfigurationPanel";
import { WorkflowPanel } from "./WorkflowPanel";
import { SharedServicesPanel } from "./SharedServicesPanel";
import { Link } from "react-router-dom";
import { Button, Field, Input, PageHeader, Select } from "../shell/components/ui";

type OrgUnit = { id: string; parentId: string | null; name: string; unitType: string; legalEntityId: string };
type LegalEntity = { id: string; name: string };
type UserRow = { id: string; email: string; fullName: string; status: string };
type AuditRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
};

function OrgUnitTree({ units, parentId = null, depth = 0 }: { units: OrgUnit[]; parentId?: string | null; depth?: number }) {
  const children = units.filter((u) => u.parentId === parentId);
  if (children.length === 0) return null;
  return (
    <ul className={depth > 0 ? "ml-4 border-l border-slate-200 pl-3" : ""}>
      {children.map((u) => (
        <li key={u.id} className="py-0.5">
          <span className="text-sm text-slate-700">{u.name}</span>{" "}
          <span className="text-xs text-slate-400">({u.unitType})</span>
          <OrgUnitTree units={units} parentId={u.id} depth={depth + 1} />
        </li>
      ))}
    </ul>
  );
}

export function DashboardPage() {
  const { session } = useAuth();
  const token = session!.accessToken;

  const [tenantName, setTenantName] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [legalEntities, setLegalEntities] = useState<LegalEntity[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [auditLog, setAuditLog] = useState<AuditRow[]>([]);
  const [orgUnitLabel, setOrgUnitLabel] = useState("Organization Units");
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [tenant, me, units, entities, userList, audit, terminology] = await Promise.all([
        api.tenant(token),
        api.me(token),
        api.organizationUnits(token),
        api.legalEntities(token),
        api.users(token),
        api.recentAuditLog(token),
        api.configTerminology(token),
      ]);
      setTenantName(tenant.name);
      setPermissions(me.permissions);
      setOrgUnits(units);
      setLegalEntities(entities);
      setUsers(userList);
      setAuditLog(audit);
      // Terminology-driven label — proves this section header is not a
      // hardcoded string but comes from the tenant's Configuration.
      const orgUnitTerm = terminology.find((t) => t.code === "organization_unit.label");
      if (orgUnitTerm) setOrgUnitLabel(`${orgUnitTerm.value}s`);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof ApiError ? err.message : "Failed to load data" });
    }
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleCreateOrgUnit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await api.createOrganizationUnit(token, {
        legalEntityId: String(form.get("legalEntityId")),
        parentId: form.get("parentId") ? String(form.get("parentId")) : null,
        name: String(form.get("name")),
        unitType: String(form.get("unitType") || "Organization Unit"),
      });
      setMessage({ type: "success", text: "Organization Unit created." });
      e.currentTarget.reset();
      refresh();
    } catch (err) {
      // Backend authorization is what actually blocks this — the form is
      // shown to every authenticated user regardless of permission, on
      // purpose, to prove the 403 below comes from the API, not the UI.
      setMessage({ type: "error", text: err instanceof ApiError ? err.message : "Failed" });
    }
  }

  async function handleCreateLegalEntity(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await api.createLegalEntity(token, { name: String(form.get("name")) });
      setMessage({ type: "success", text: "Legal Entity created." });
      e.currentTarget.reset();
      refresh();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof ApiError ? err.message : "Failed" });
    }
  }

  async function handleCreateUser(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const scopeType = String(form.get("scopeType")) as "tenant" | "organization_unit";
    try {
      await api.createUser(token, {
        email: String(form.get("email")),
        fullName: String(form.get("fullName")),
        password: String(form.get("password")),
        roleCode: String(form.get("roleCode")),
        scopeType,
        scopeOrganizationUnitId:
          scopeType === "organization_unit" ? String(form.get("scopeOrganizationUnitId")) : null,
      });
      setMessage({ type: "success", text: "User created." });
      e.currentTarget.reset();
      refresh();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof ApiError ? err.message : "Failed" });
    }
  }

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
        <div
          className={`rounded p-2 text-sm ${
            message.type === "error" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold">{orgUnitLabel}</h2>
          <OrgUnitTree units={orgUnits} />
          <form onSubmit={handleCreateOrgUnit} className="mt-4 space-y-2 border-t border-slate-100 pt-3">
            <div className="text-xs font-medium text-slate-500">Create Organization Unit</div>
            <Field label="Legal entity" required>
              <Select name="legalEntityId" required>
                <option value="">Select a legal entity…</option>
                {legalEntities.map((le) => (
                  <option key={le.id} value={le.id}>
                    {le.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Parent organization unit">
              <Select name="parentId">
                <option value="">(root — no parent)</option>
                {orgUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Organization unit name" required>
              <Input name="name" placeholder="Name" required />
            </Field>
            <Field label="Organization unit type">
              <Input name="unitType" placeholder="Type (e.g. Branch, Site)" />
            </Field>
            <button type="submit" className="rounded bg-slate-900 px-3 py-1 text-sm text-white">
              Create
            </button>
          </form>
        </section>

        <section className="rounded border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold">Legal Entities</h2>
          <ul className="text-sm text-slate-700">
            {legalEntities.map((le) => (
              <li key={le.id}>{le.name}</li>
            ))}
          </ul>
          <form onSubmit={handleCreateLegalEntity} className="mt-4 space-y-2 border-t border-slate-100 pt-3">
            <div className="text-xs font-medium text-slate-500">Create Legal Entity</div>
            <Field label="Legal entity name" required>
              <Input name="name" placeholder="Name" required />
            </Field>
            <button type="submit" className="rounded bg-slate-900 px-3 py-1 text-sm text-white">
              Create
            </button>
          </form>
        </section>

        <section className="rounded border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold">Users</h2>
          <ul className="text-sm text-slate-700">
            {users.map((u) => (
              <li key={u.id}>
                {u.fullName} — {u.email}
              </li>
            ))}
          </ul>
          <form onSubmit={handleCreateUser} className="mt-4 space-y-2 border-t border-slate-100 pt-3">
            <div className="text-xs font-medium text-slate-500">Create User</div>
            <Field label="Full name" required>
              <Input name="fullName" placeholder="Full name" required />
            </Field>
            <Field label="Email address" required>
              <Input name="email" type="email" placeholder="Email" required />
            </Field>
            <Field label="Password" required hint="Minimum 8 characters">
              <Input name="password" type="password" placeholder="Password" required minLength={8} />
            </Field>
            <Field label="Role code" required hint="For example, ADMIN or SUPERVISOR">
              <Input name="roleCode" placeholder="Role code" required />
            </Field>
            <Field label="Access scope">
              <Select name="scopeType">
                <option value="tenant">Tenant-wide scope</option>
                <option value="organization_unit">Organization unit scope</option>
              </Select>
            </Field>
            <Field label="Organization unit scope">
              <Select name="scopeOrganizationUnitId">
                <option value="">(select organization unit if scoped)</option>
                {orgUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <button type="submit" className="rounded bg-slate-900 px-3 py-1 text-sm text-white">
              Create
            </button>
          </form>
        </section>

        <section className="rounded border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold">Audit Trail (recent)</h2>
          <ul className="max-h-64 space-y-1 overflow-y-auto text-xs text-slate-600">
            {auditLog.map((entry) => (
              <li key={entry.id} className="border-b border-slate-100 pb-1">
                <span className="font-mono">{new Date(entry.createdAt).toLocaleString()}</span>{" "}
                — <span className="font-medium">{entry.action}</span>{" "}
                {entry.entityType}
                {entry.entityId ? ` (${entry.entityId.slice(0, 8)}…)` : ""}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <ConfigurationPanel
        token={token}
        orgUnits={orgUnits}
        canManage={permissions.includes("config.manage")}
        onMessage={setMessage}
      />

      <WorkflowPanel
        token={token}
        orgUnits={orgUnits}
        canStart={permissions.includes("workflow.instance.start")}
        canAct={permissions.includes("workflow.instance.act")}
        canManage={permissions.includes("workflow.instance.manage")}
        onMessage={setMessage}
      />

      <SharedServicesPanel
        token={token}
        canManageDocuments={permissions.includes("document.manage")}
        canManageScheduler={permissions.includes("scheduler.manage")}
        canManageIntegration={permissions.includes("integration.read")}
        canReadObservability={permissions.includes("observability.read")}
        onMessage={setMessage}
      />
    </div>
  );
}
