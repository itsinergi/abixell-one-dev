/**
 * Checkpoint 1C.3 — Operational complaint detail (internal). Richer than the
 * customer view: role-appropriate timeline (actor + comments), investigation
 * capture, workflow actions, evidence, and reopen. Backend restricts this to
 * internal actors and enforces every action.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type DocumentRecord,
  type OperationalComplaintDetail,
} from "../../lib/api";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  StatusPill,
  Textarea,
  Timeline,
  type TimelineItem,
} from "../../shell/components/ui";
import { formatDate, severityTone, slaIndicator, statusTone } from "../complaints/format";

export function OperationalDetailPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const { complaintId } = useParams<{ complaintId: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<OperationalComplaintDetail | null>(null);
  const [evidence, setEvidence] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [reopenStep, setReopenStep] = useState("");
  const [savingInvestigation, setSavingInvestigation] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    if (!complaintId) return;
    setLoading(true);
    setError(null);
    try {
      const [d, docs] = await Promise.all([
        api.operationalDetail(token, complaintId),
        api.documentsForEntity(token, "complaint", complaintId),
      ]);
      setDetail(d);
      setEvidence(docs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load complaint");
    } finally {
      setLoading(false);
    }
  }, [token, complaintId]);

  useEffect(() => {
    load();
  }, [load]);

  async function runAction(actionCode: string) {
    if (!complaintId) return;
    setBusy(actionCode);
    setNotice(null);
    try {
      await api.actOnComplaint(token, complaintId, actionCode, comment.trim() || null);
      setComment("");
      setNotice({ tone: "success", text: "Action completed." });
      await load();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : "Action failed" });
    } finally {
      setBusy(null);
    }
  }

  async function runReopen() {
    if (!complaintId || !reopenStep) return;
    setBusy("reopen");
    setNotice(null);
    try {
      await api.reopenComplaint(token, complaintId, reopenStep, comment.trim() || null);
      setComment("");
      setReopenStep("");
      setNotice({ tone: "success", text: "Complaint reopened." });
      await load();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : "Reopen failed" });
    } finally {
      setBusy(null);
    }
  }

  async function saveInvestigation(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!complaintId) return;
    const form = new FormData(e.currentTarget);
    setSavingInvestigation(true);
    setNotice(null);
    try {
      await api.updateComplaintInvestigation(token, complaintId, {
        rootCause: (form.get("rootCause") as string) || null,
        correctiveAction: (form.get("correctiveAction") as string) || null,
        preventiveAction: (form.get("preventiveAction") as string) || null,
        correctiveActionTargetDate: (form.get("correctiveActionTargetDate") as string) || null,
      });
      setNotice({ tone: "success", text: "Investigation saved." });
      await load();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : "Save failed" });
    } finally {
      setSavingInvestigation(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !complaintId) return;
    setUploading(true);
    setNotice(null);
    try {
      await api.uploadDocument(token, "complaint", complaintId, file);
      setNotice({ tone: "success", text: "Evidence uploaded." });
      setEvidence(await api.documentsForEntity(token, "complaint", complaintId));
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : "Upload failed" });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function downloadEvidence(doc: DocumentRecord) {
    try {
      const blob = await api.downloadDocument(token, doc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : "Download failed" });
    }
  }

  if (loading) return <Spinner label="Loading complaint…" />;
  if (error)
    return (
      <div className="space-y-3">
        <Alert tone="error">{error}</Alert>
        <Button variant="secondary" onClick={() => navigate("/queue")}>
          Back to queue
        </Button>
      </div>
    );
  if (!detail) return null;

  const { complaint, customerName, status, sla, assignment, timeline, availableActions, reopen } = detail;
  const slaState = slaIndicator(sla);

  const timelineItems: TimelineItem[] = timeline.map((t, i) => ({
    key: `${t.occurredAt}-${i}`,
    title: t.toStepName ? `${t.actionCode} → ${t.toStepName}` : t.actionCode,
    timestamp: t.occurredAt,
    detail: (
      <>
        {t.comment && <div>{t.comment}</div>}
        <div className="text-xs text-slate-400">
          {t.actorUserId ? `by ${t.actorUserId.slice(0, 8)}…` : "by system"}
        </div>
      </>
    ),
  }));

  return (
    <div>
      <PageHeader
        title={complaint.complaintNumber}
        subtitle={`${customerName ?? "Customer"} · ${complaint.category}${complaint.subcategory ? ` · ${complaint.subcategory}` : ""}`}
        actions={
          <Button variant="secondary" onClick={() => navigate("/queue")}>
            Back to queue
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusPill tone={statusTone(status?.instanceStatus)}>
          {status?.stepName ?? status?.instanceStatus ?? "Unknown"}
        </StatusPill>
        <StatusPill tone={severityTone(complaint.severity)}>Severity: {complaint.severity}</StatusPill>
        <Badge>Priority: {complaint.priority}</Badge>
        {slaState && <StatusPill tone={slaState.tone}>{slaState.label}</StatusPill>}
        {assignment?.isMine && <StatusPill tone="info">Assigned to you / your team</StatusPill>}
      </div>

      {notice && (
        <div className="mb-4">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Complaint</h2>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{complaint.description}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-sm">
              <Detail term="Customer" value={customerName ?? "—"} />
              <Detail term="Assigned role" value={assignment?.roleCode ?? "—"} />
              <Detail term="Submitted" value={formatDate(complaint.submittedAt)} />
              {sla?.dueAt && <Detail term="SLA due" value={formatDate(sla.dueAt)} />}
              {complaint.closureDate && <Detail term="Closed" value={formatDate(complaint.closureDate)} />}
            </dl>
          </Card>

          <Card>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Investigation</h2>
            <form onSubmit={saveInvestigation} className="space-y-3">
              <Field label="Root cause">
                <Textarea name="rootCause" rows={2} defaultValue={complaint.rootCause ?? ""} />
              </Field>
              <Field label="Corrective action">
                <Textarea name="correctiveAction" rows={2} defaultValue={complaint.correctiveAction ?? ""} />
              </Field>
              <Field label="Preventive action">
                <Textarea name="preventiveAction" rows={2} defaultValue={complaint.preventiveAction ?? ""} />
              </Field>
              <Field label="Corrective action target date">
                <Input
                  name="correctiveActionTargetDate"
                  type="date"
                  defaultValue={complaint.correctiveActionTargetDate ?? ""}
                />
              </Field>
              <Button type="submit" disabled={savingInvestigation}>
                {savingInvestigation ? "Saving…" : "Save investigation"}
              </Button>
            </form>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Operational timeline</h2>
            <Timeline items={timelineItems} />
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Evidence</h2>
              <label className="cursor-pointer text-sm font-medium text-slate-700 hover:underline">
                {uploading ? "Uploading…" : "Add file"}
                <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
              </label>
            </div>
            {evidence.length === 0 ? (
              <p className="text-sm text-slate-500">No evidence attached yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {evidence.map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between py-2">
                    <div className="min-w-0">
                      <div className="truncate text-slate-700">{doc.fileName}</div>
                      <div className="text-xs text-slate-400">
                        {(doc.sizeBytes / 1024).toFixed(1)} KB · {formatDate(doc.createdAt)}
                      </div>
                    </div>
                    <Button variant="ghost" onClick={() => downloadEvidence(doc)}>
                      Download
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Actions</h2>
            {availableActions.length === 0 && !reopen.canReopen ? (
              <p className="text-sm text-slate-500">No actions are available to you at this step.</p>
            ) : (
              <div className="space-y-3">
                <Field label="Comment" hint="Optional — recorded with your action">
                  <Textarea
                    rows={3}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Add a note (optional)"
                  />
                </Field>
                {availableActions.map((a) => (
                  <Button
                    key={a.actionCode}
                    className="w-full"
                    disabled={busy !== null}
                    onClick={() => runAction(a.actionCode)}
                  >
                    {busy === a.actionCode ? "Working…" : a.name}
                  </Button>
                ))}

                {reopen.canReopen && (
                  <div className="space-y-2 border-t border-slate-100 pt-3">
                    <Field label="Reopen to step">
                      <Select value={reopenStep} onChange={(e) => setReopenStep(e.target.value)}>
                        <option value="">Select a step…</option>
                        {reopen.targetSteps.map((s) => (
                          <option key={s.code} value={s.code}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Button
                      variant="secondary"
                      className="w-full"
                      disabled={!reopenStep || busy !== null}
                      onClick={runReopen}
                    >
                      {busy === "reopen" ? "Working…" : "Reopen complaint"}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{term}</dt>
      <dd className="text-slate-700">{value}</dd>
    </div>
  );
}
