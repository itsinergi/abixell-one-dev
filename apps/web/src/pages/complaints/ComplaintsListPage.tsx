/**
 * Checkpoint 1C.2 — Customer complaint list. Shows only complaints within
 * the actor's Customer Data Scope (backend-enforced). Real data end to end.
 */
import { useT } from "../../i18n/LocaleProvider";
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
  const t = useT();
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
        setError(err instanceof ApiError ? err.message : t("cmp.list.msg.failedToLoadComplaints"));
      } finally {
        setLoading(false);
      }
    },
    [token, t],
  );

  useEffect(() => {
    if (selectedId) loadComplaints(selectedId);
    else setItems([]);
  }, [selectedId, loadComplaints]);

  return (
    <div>
      <PageHeader
        title={t("cmp.list.title.complaints")}
        subtitle={t("cmp.list.sub.raiseANewComplaintAndTrackTheOnesYouHave")}
        actions={
          selectedId ? (
            <Link to={`/complaints/new?customerId=${selectedId}`}>
              <Button>{t("cmp.list.t.newComplaint")}</Button>
            </Link>
          ) : undefined
        }
      />

      {customersError && <Alert tone="error">{customersError}</Alert>}

      {customersLoading ? (
        <Spinner label={t("cmp.list.f.loadingYourCustomers")} />
      ) : customers.length === 0 ? (
        <EmptyState
          title={t("cmp.list.title.noCustomerAvailable")}
          description={t("cmp.list.d.yourAccountIsNotLinkedToACustomerYetPlea")}
        />
      ) : (
        <div className="space-y-4">
          {customers.length > 1 && (
            <div className="max-w-sm">
              <Field label={t("cmp.list.f.customer")}>
                <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                  <option value="">{t("cmp.list.t.selectACustomer")}</option>
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
            <EmptyState title={t("cmp.list.title.selectACustomer")} description={t("cmp.list.d.chooseACustomerToSeeItsComplaints")} />
          ) : loading ? (
            <Spinner label={t("cmp.list.f.loadingComplaints")} />
          ) : error ? (
            <Alert tone="error">{error}</Alert>
          ) : items.length === 0 ? (
            <EmptyState
              title={t("cmp.list.title.noComplaintsYet")}
              description={t("cmp.list.d.whenYouSubmitAComplaintItWillAppearHereW")}
              action={
                <Link to={`/complaints/new?customerId=${selectedId}`}>
                  <Button>{t("cmp.list.t.createYourFirstComplaint")}</Button>
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
