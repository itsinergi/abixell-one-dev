/**
 * Phase 2 — Field execution surface (SO-CORE-008 / SO-CORE-009 /
 * SO-CORE-010 / SO-CORE-014).
 *
 * Start → complete the checklist → attach evidence → complete the work.
 * Evidence uploads reuse Document Core (`entityType: work_order`), so no
 * attachment subsystem exists here. Nothing is cached offline (PWA policy).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { api, ApiError, type WorkOrderDetail } from "../../lib/api";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  PageHeader,
  Spinner,
  StatusPill,
  Textarea,
} from "../../shell/components/ui";
import { formatDate, formatDateShort, statusTone } from "../../shared/format";

export function MyWorkDetailPage() {
  const { workOrderId } = useParams<{ workOrderId: string }>();
  const { session } = useAuth();
  const token = session!.accessToken;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [detail, setDetail] = useState<WorkOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [completionNotes, setCompletionNotes] = useState("");

  const load = useCallback(async () => {
    if (!workOrderId) return;
    setLoading(true);
    setError(null);
    try {
      setDetail(await api.workOrder(token, workOrderId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this job.");
    } finally {
      setLoading(false);
    }
  }, [token, workOrderId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadEvidence(file: File) {
    if (!workOrderId) return;
    // Reuses Document Core exactly as other modules do — the Work Order's
    // own authorization governs the attachment (ADR-0012).
    await run(() => api.uploadDocument(token, "work_order", workOrderId, file), "Evidence attached.");
  }

  if (loading) return <Spinner />;
  if (!detail) return <Alert tone="error">{error ?? "Job not found."}</Alert>;

  const { workOrder, serviceDefinition, checklist, status } = detail;
  const requiredOutstanding = checklist.filter((c) => c.isRequired && !c.isCompleted);
  const isCompleted = Boolean(workOrder.completedAt);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${workOrder.workOrderNumber} — ${workOrder.title}`}
        subtitle={serviceDefinition?.name}
        actions={
          status ? (
            <StatusPill tone={statusTone(status.instanceStatus)}>
              {status.stepName ?? status.stepCode ?? status.instanceStatus}
            </StatusPill>
          ) : null
        }
      />

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <h2 className="mb-2 text-sm font-semibold text-slate-800">What to do</h2>
        <p className="text-sm text-slate-700">{workOrder.description ?? "No description provided."}</p>
        <p className="mt-2 text-sm text-slate-500">Due {formatDateShort(workOrder.dueAt)}</p>
      </Card>

      {isCompleted ? (
        <Alert tone="success">
          Completed on {formatDate(workOrder.completedAt)}
          {workOrder.verifiedAt ? " · verified by your supervisor" : " · awaiting supervisor verification"}.
        </Alert>
      ) : (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Execution</h2>
          {workOrder.startedAt ? (
            <p className="text-sm text-slate-600">Started {formatDate(workOrder.startedAt)}.</p>
          ) : (
            <Button disabled={busy} onClick={() => run(() => api.startWorkOrder(token, workOrder.id), "Work started.")}>
              Start work
            </Button>
          )}
        </Card>
      )}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">
          Checklist{" "}
          <Badge>
            {checklist.filter((c) => c.isCompleted).length}/{checklist.length}
          </Badge>
        </h2>
        {checklist.length === 0 ? (
          <p className="text-sm text-slate-500">No checklist for this job.</p>
        ) : (
          <ul className="space-y-2">
            {checklist.map((item) => (
              <li key={item.id} className="flex items-start gap-3">
                <input
                  id={`check-${item.id}`}
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-slate-300"
                  checked={item.isCompleted}
                  disabled={busy || isCompleted}
                  onChange={(e) =>
                    run(
                      () =>
                        api.setWorkOrderChecklistItem(token, workOrder.id, item.id, {
                          isCompleted: e.target.checked,
                        }),
                      "Checklist updated.",
                    )
                  }
                />
                <label htmlFor={`check-${item.id}`} className="text-sm text-slate-800">
                  {item.label}
                  {item.isRequired ? <span className="ml-1 text-rose-600" aria-hidden="true">*</span> : null}
                  {item.isRequired ? <span className="sr-only"> (required)</span> : null}
                </label>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Evidence</h2>
        <input
          ref={fileInputRef}
          type="file"
          aria-label="Attach evidence"
          className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
          disabled={busy || isCompleted}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadEvidence(file);
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
        />
        <p className="mt-2 text-xs text-slate-500">Photos or documents proving the work was carried out.</p>
      </Card>

      {!isCompleted ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Complete</h2>
          {requiredOutstanding.length > 0 ? (
            <Alert tone="info">
              Complete the required checklist items first: {requiredOutstanding.map((c) => c.label).join(", ")}.
            </Alert>
          ) : null}
          <Field label="Completion notes">
            <Textarea
              rows={3}
              value={completionNotes}
              onChange={(e) => setCompletionNotes(e.target.value)}
              placeholder="Anything the supervisor should know"
            />
          </Field>
          <div className="mt-3">
            <Button
              disabled={busy || requiredOutstanding.length > 0}
              onClick={() =>
                run(() => api.completeWorkOrder(token, workOrder.id, completionNotes || null), "Work completed.")
              }
            >
              Complete work
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
