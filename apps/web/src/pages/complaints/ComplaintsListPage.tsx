/**
 * Checkpoint 1C.2 — Customer complaint list. Shows only complaints within
 * the actor's Customer Data Scope (backend-enforced). Real data end to end.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, type ComplaintSummaryItem } from "../../lib/api";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  PageHeader,
  Select,
  Spinner,
  StatusPill,
} from "../../shell/components/ui";
import { useCustomerScope } from "./useCustomerScope";
import { formatDateShort, severityTone, slaIndicator, statusTone } from "./format";

export function ComplaintsListPage() {
  const {
    token,
    customers,
    selectedId,
    setSelectedId,
    loading: customersLoading,
    error: customersError,
  } = useCustomerScope();

  const [items, setItems] = useState<ComplaintSummaryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadComplaints = useCallback(
    async (customerId: string) => {
      setLoading(true);
      setError(null);
      try {
        setItems(await api.complaintsByCustomerSummary(token, customerId));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load complaints");
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (selectedId) loadComplaints(selectedId);
    else setItems([]);
  }, [selectedId, loadComplaints]);

  return (
    <div>
      <PageHeader
        title="Complaints"
        subtitle="Raise a new complaint and track the ones you have submitted."
        actions={
          selectedId ? (
            <Link to={`/complaints/new?customerId=${selectedId}`}>
              <Button>New complaint</Button>
            </Link>
          ) : undefined
        }
      />

      {customersError && <Alert tone="error">{customersError}</Alert>}

      {customersLoading ? (
        <Spinner label="Loading your customers…" />
      ) : customers.length === 0 ? (
        <EmptyState
          title="No customer available"
          description="Your account is not linked to a customer yet. Please contact your administrator."
        />
      ) : (
        <div className="space-y-4">
          {customers.length > 1 && (
            <div className="max-w-sm">
              <Field label="Customer">
                <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                  <option value="">Select a customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}

          {!selectedId ? (
            <EmptyState title="Select a customer" description="Choose a customer to see its complaints." />
          ) : loading ? (
            <Spinner label="Loading complaints…" />
          ) : error ? (
            <Alert tone="error">{error}</Alert>
          ) : items.length === 0 ? (
            <EmptyState
              title="No complaints yet"
              description="When you submit a complaint it will appear here with its status and progress."
              action={
                <Link to={`/complaints/new?customerId=${selectedId}`}>
                  <Button>Create your first complaint</Button>
                </Link>
              }
            />
          ) : (
            <ul className="space-y-3">
              {items.map(({ complaint, status, sla }) => {
                const slaState = slaIndicator(sla);
                return (
                  <li key={complaint.id}>
                    <Link
                      to={`/complaints/${complaint.id}`}
                      className="block rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 hover:bg-slate-50"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-sm font-semibold text-slate-800">
                          {complaint.complaintNumber}
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill tone={statusTone(status?.instanceStatus)}>
                            {status?.stepName ?? status?.instanceStatus ?? "Unknown"}
                          </StatusPill>
                          {slaState && <StatusPill tone={slaState.tone}>{slaState.label}</StatusPill>}
                        </div>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-slate-600">{complaint.description}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <Badge>{complaint.category}</Badge>
                        <StatusPill tone={severityTone(complaint.severity)}>
                          Severity: {complaint.severity}
                        </StatusPill>
                        <span>Created {formatDateShort(complaint.createdAt)}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
