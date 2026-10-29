/**
 * Checkpoint 1C.4 — Verification detail (QA / verifier). Reuses the existing
 * operational detail read-model; the composition is verifier-focused: review
 * the investigation result + evidence, then perform independent verification
 * via the existing workflow actions. Verification note uses the existing
 * /verification endpoint; the outcome uses the workflow `verify` transition
 * (or any configured return/reject). Backend is the authorization truth.
 */
import { useT } from "../../i18n/LocaleProvider";
import { useCallback, useEffect, useState } from "react";
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
  EmptyState,
  Field,
  PageHeader,
  Spinner,
  StatusPill,
  Textarea,
  Timeline,
  type TimelineItem,
} from "../../shell/components/ui";
import { formatDate, severityTone, slaIndicator, statusTone } from "../complaints/format";

export function VerificationDetailPage() {
  const t = useT();
  const { session } = useAuth();
  const token = session!.accessToken;
  const { complaintId } = useParams<{ complaintId: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<OperationalComplaintDetail | null>(null);
  const [evidence, setEvidence] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
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
      setError(err instanceof ApiError ? err.message : t("ver.detail.msg.failedToLoadComplaint"));
    } finally {
      setLoading(false);
    }
  }, [token, complaintId, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function runAction(actionCode: string) {
    if (!complaintId) return;
    setBusy(actionCode);
    setNotice(null);
    try {
      // Record the independent verification note (existing /verification
      // endpoint) when signing off, then advance via the workflow transition.
      if (actionCode === "verify" && note.trim()) {
        await api.verifyComplaint(token, complaintId, note.trim());
      }
      await api.actOnComplaint(token, complaintId, actionCode, note.trim() || null);
      setNote("");
      setNotice({ tone: "success", text: "Verification recorded." });
      await load();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : t("ver.detail.msg.actionFailed") });
    } finally {
      setBusy(null);
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
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : t("ver.detail.msg.uploadFailed") });
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
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : t("ver.detail.msg.downloadFailed") });
    }
  }

  if (loading) return <Spinner label={t("ver.detail.f.loadingComplaint")} />;
  if (error)
    return (
      <div className="space-y-3">
        <Alert tone="error">{error}</Alert>
        <Button variant="secondary" onClick={() => navigate("/verification")}>
          Back to verification queue
        </Button>
      </div>
    );
  if (!detail) return null;

  const { complaint, customerName, status, sla, assignment, timeline, availableActions } = detail;
  const slaState = slaIndicator(sla);
  const hasInvestigation =
    complaint.rootCause || complaint.correctiveAction || complaint.preventiveAction;

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

  const canVerifyHere = status?.stepCode === "VERIFICATION" && assignment?.isMine;

  return (
    <div>
      <PageHeader
        title={complaint.complaintNumber}
        subtitle={`${customerName ?? "Customer"} · ${complaint.category}`}
        actions={
          <Button variant="secondary" onClick={() => navigate("/verification")}>
            Back to queue
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusPill tone={statusTone(status?.instanceStatus)}>
          {status?.stepName ?? status?.instanceStatus ?? "Unknown"}
        </StatusPill>
        <StatusPill tone={severityTone(complaint.severity)}>Severity: {complaint.severity}</StatusPill>
        <Badge>{t("ver.detail.t.priorityN", { n: complaint.priority })}</Badge>
        {slaState && <StatusPill tone={slaState.tone}>{slaState.label}</StatusPill>}
      </div>

      {notice && (
        <div className="mb-4">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">{t("ver.detail.t.complaint")}</h2>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{complaint.description}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-sm">
              <Detail term="Customer" value={customerName ?? "—"} />
              <Detail term="Handled by" value={assignment?.roleCode ?? "—"} />
              <Detail term="Submitted" value={formatDate(complaint.submittedAt)} />
              {sla?.dueAt && <Detail term="SLA due" value={formatDate(sla.dueAt)} />}
            </dl>
          </Card>

          <Card>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">{t("ver.detail.t.investigationResult")}</h2>
            {hasInvestigation ? (
              <dl className="space-y-3 text-sm">
                <Detail term="Root cause" value={complaint.rootCause ?? "—"} />
                <Detail term="Corrective action" value={complaint.correctiveAction ?? "—"} />
                <Detail term="Preventive action" value={complaint.preventiveAction ?? "—"} />
                {complaint.correctiveActionTargetDate && (
                  <Detail term="Target date" value={complaint.correctiveActionTargetDate} />
                )}
              </dl>
            ) : (
              <p className="text-sm text-slate-500">{t("ver.detail.n.noInvestigationHasBeenRecordedYet")}</p>
            )}
            {complaint.verificationNote && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <Detail term="Previous verification note" value={complaint.verificationNote} />
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-700">{t("ver.detail.t.timeline")}</h2>
            <Timeline items={timelineItems} />
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">{t("ver.detail.t.evidence")}</h2>
              <label className="cursor-pointer text-sm font-medium text-slate-700 hover:underline">
                {uploading ? "Uploading…" : "Add file"}
                <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
              </label>
            </div>
            {evidence.length === 0 ? (
              <p className="text-sm text-slate-500">{t("ver.detail.n.noEvidenceAttached")}</p>
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
            <h2 className="mb-3 text-sm font-semibold text-slate-700">{t("ver.detail.t.verification")}</h2>
            {availableActions.length === 0 ? (
              <EmptyState
                title={t("ver.detail.title.noVerificationActionAvailable")}
                description={
                  canVerifyHere === false && status?.stepCode === "VERIFICATION"
                    ? "This complaint is awaiting a different verifier."
                    : "This complaint is not awaiting your verification right now."
                }
              />
            ) : (
              <div className="space-y-3">
                <Field label={t("ver.detail.f.verificationNote")} hint={t("ver.detail.n.recordedWithYourDecision")}>
                  <Textarea
                    rows={4}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t("ver.detail.p.summariseYourIndependentVerification")}
                  />
                </Field>
                {availableActions.map((a) => (
                  <Button
                    key={a.actionCode}
                    className="w-full"
                    variant={a.actionCode === "verify" ? "primary" : "secondary"}
                    disabled={busy !== null}
                    onClick={() => runAction(a.actionCode)}
                  >
                    {busy === a.actionCode ? "Working…" : a.name}
                  </Button>
                ))}
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
      <dd className="whitespace-pre-wrap text-slate-700">{value}</dd>
    </div>
  );
}
