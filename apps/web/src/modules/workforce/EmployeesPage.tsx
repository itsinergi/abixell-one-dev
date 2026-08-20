/**
 * Phase 3 — Workforce employee directory (HR-CORE-010).
 *
 * List, search, filter, and create employees. Presentation only: Data Scope
 * and authorization are enforced by the backend, which returns exactly the
 * employees this user may see.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { api, ApiError, type Employee, type PositionRecord } from "../../lib/api";
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  StatusPill,
  type Column,
} from "../../shell/components/ui";
import { formatDateShort } from "../../shared/format";

/** Minimal shapes for the org pickers — the API client returns these
 * inline, so only what this page renders is modelled here. */
type LegalEntityOption = { id: string; name: string };
type OrganizationUnitOption = { id: string; name: string };

function statusTone(status: string): "success" | "neutral" | "warning" {
  if (status === "active") return "success";
  if (status === "ended") return "neutral";
  return "warning";
}

export function EmployeesPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const navigate = useNavigate();

  const [rows, setRows] = useState<Employee[]>([]);
  const [positions, setPositions] = useState<PositionRecord[]>([]);
  const [legalEntities, setLegalEntities] = useState<LegalEntityOption[]>([]);
  const [units, setUnits] = useState<OrganizationUnitOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [positionCode, setPositionCode] = useState("");
  const [legalEntityId, setLegalEntityId] = useState("");
  const [organizationUnitId, setOrganizationUnitId] = useState("");
  const [joinedAt, setJoinedAt] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [employees, positionList, legalEntityList, unitList] = await Promise.all([
        api.employees(token, { search: search || undefined, employmentStatus: statusFilter || undefined }),
        api.positions(token).catch(() => [] as PositionRecord[]),
        api.legalEntities(token).catch(() => [] as LegalEntityOption[]),
        api.organizationUnits(token).catch(() => [] as OrganizationUnitOption[]),
      ]);
      setRows(employees);
      setPositions(positionList.filter((p) => p.isActive));
      setLegalEntities(legalEntityList);
      setUnits(unitList);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load employees.");
    } finally {
      setLoading(false);
    }
  }, [token, search, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createEmployee() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.createEmployee(token, {
        fullName,
        email: email || null,
        positionCode: positionCode || null,
        legalEntityId: legalEntityId || null,
        organizationUnitId: organizationUnitId || null,
        joinedAt: joinedAt || null,
      });
      setNotice("Employee created.");
      setFullName("");
      setEmail("");
      setJoinedAt("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the employee.");
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<Employee>[] = [
    { header: "Number", cell: (row) => <span className="font-medium">{row.employeeNumber}</span> },
    { header: "Name", cell: (row) => row.fullName },
    {
      header: "Status",
      cell: (row) => <StatusPill tone={statusTone(row.employmentStatus)}>{row.employmentStatus}</StatusPill>,
    },
    { header: "Joined", cell: (row) => formatDateShort(row.joinedAt) },
    { header: "Account", cell: (row) => (row.userId ? "Linked" : "—") },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Employees" subtitle="Who works here, and where they belong in the organisation." />

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Add an employee</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Full name" required>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Position">
            <Select value={positionCode} onChange={(e) => setPositionCode(e.target.value)}>
              <option value="">—</option>
              {positions.map((p) => (
                <option key={p.id} value={p.code}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Legal entity">
            <Select value={legalEntityId} onChange={(e) => setLegalEntityId(e.target.value)}>
              <option value="">—</option>
              {legalEntities.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Organization unit">
            <Select value={organizationUnitId} onChange={(e) => setOrganizationUnitId(e.target.value)}>
              <option value="">—</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end gap-3">
            <Field label="Joined">
              <Input type="date" value={joinedAt} onChange={(e) => setJoinedAt(e.target.value)} />
            </Field>
            <Button disabled={busy || !fullName} onClick={() => void createEmployee()}>
              Create
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Search">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or employee number"
            />
          </Field>
          <Field label="Status">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="ended">Ended</option>
            </Select>
          </Field>
        </div>
      </Card>

      {loading ? (
        <Spinner />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          keyOf={(row) => row.id}
          onRowClick={(row) => navigate(`/employees/${row.id}`)}
          empty={<EmptyState title="No employees found" description="Add one above, or adjust your search." />}
        />
      )}
    </div>
  );
}
