/**
 * Phase 2 — Coordinator/supervisor work queue (SO-CORE-013).
 *
 * First frontend module under the frozen target architecture
 * (`modules/<module>/`). Presentation only: every status, SLA value, and
 * available action comes from the backend's authoritative Workflow state —
 * this page never recomputes lifecycle or SLA rules.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type Customer,
  type ServiceDefinition,
  type WorkOrderRow,
} from "../../lib/api";
import {
  Alert,
  Badge,
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
import { dueIndicator, formatDateShort, statusTone } from "../../shared/format";

export function WorkOrderQueuePage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const navigate = useNavigate();

  const [rows, setRows] = useState<WorkOrderRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState("");
  const [serviceCode, setServiceCode] = useState("");
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [orders, customerList, definitions] = await Promise.all([
        api.workOrders(token),
        api.customers(token).catch(() => [] as Customer[]),
        api.serviceDefinitions(token).catch(() => [] as ServiceDefinition[]),
      ]);
      setRows(orders);
      setCustomers(customerList);
      setServiceTypes(definitions.filter((d) => d.isActive));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load work orders.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  async function createWorkOrder() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.createWorkOrder(token, {
        customerId,
        serviceDefinitionCode: serviceCode,
        title,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      });
      setNotice("Work order created.");
      setTitle("");
      setDueAt("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the work order.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  const columns: Column<WorkOrderRow>[] = [
    {
      header: "Number",
      cell: (row) => <span className="font-medium">{row.workOrder.workOrderNumber}</span>,
    },
    { header: "Work", cell: (row) => row.workOrder.title },
    {
      header: "Status",
      cell: (row) => (
        <StatusPill tone={statusTone(row.status?.instanceStatus)}>
          {row.status?.stepName ?? row.status?.stepCode ?? "—"}
        </StatusPill>
      ),
    },
    {
      header: "Assignment",
      cell: (row) => <Badge>{row.workOrder.assignedToUserId ? "Assigned" : "Unassigned"}</Badge>,
    },
    {
      header: "Due",
      cell: (row) => {
        const indicator = dueIndicator(row.workOrder.dueAt);
        return (
          <span className="flex flex-wrap items-center gap-2">
            {formatDateShort(row.workOrder.dueAt)}
            {indicator ? <StatusPill tone={indicator.tone}>{indicator.label}</StatusPill> : null}
          </span>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Work Orders"
        subtitle="Plan, assign, and follow the work your teams are delivering."
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card className="mb-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Create work order</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Customer" required>
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Select…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Service type" required>
            <Select value={serviceCode} onChange={(e) => setServiceCode(e.target.value)}>
              <option value="">Select…</option>
              {serviceTypes.map((d) => (
                <option key={d.id} value={d.code}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing" />
          </Field>
          <div className="flex items-end gap-3">
            <Field label="Due">
              <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </Field>
            <Button disabled={busy || !customerId || !serviceCode || !title} onClick={() => void createWorkOrder()}>
              Create
            </Button>
          </div>
        </div>
      </Card>

      {loading ? (
        <Spinner />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          keyOf={(row) => row.workOrder.id}
          onRowClick={(row) => navigate(`/work-orders/${row.workOrder.id}`)}
          empty={
            <EmptyState
              title="No work orders yet"
              description="Work orders appear here once a request is accepted, or when work is created directly."
            />
          }
        />
      )}
    </div>
  );
}
