/**
 * Phase 7 — Health, Safety & Environment (HSE-CORE-001…010).
 *
 * Detail view with tabs:
 * - Overview: Record details, classification, responsible party
 * - Location: Organization unit, project, site, location detail
 * - Evidence: Documents (via Document Core)
 * - Follow-ups: Actions and completion tracking
 * - Timeline: Lifecycle events and workflow history
 *
 * Allows editing classification, adding persons/follow-ups, acting on workflow.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type DocumentRecord,
  type HseRecordDetail,
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
} from "../../shell/components/ui";
import { formatDate, formatDateShort } from "../../shared/format";

export function HseDetailPage() {
  const { recordId } = useParams<{ recordId: string }>();
  const { session } = useAuth();
  const token = session!.accessToken;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [detail, setDetail] = useState<HseRecordDetail | null>(null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [documentsBlocked, setDocumentsBlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "location" | "evidence" | "follow-ups" | "timeline">("overview");

  const [categories, setCategories] = useState<{ code: string; label: string }[]>([]);
  const [severities, setSeverities] = useState<{ code: string; label: string }[]>([]);
  const [users, setUsers] = useState<{ id: string; email: string; fullName: string }[]>([]);

  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editSeverity, setEditSeverity] = useState("");
  const [editResponsibleUserId, setEditResponsibleUserId] = useState("");

  const [addPersonName, setAddPersonName] = useState("");
  const [addPersonRole, setAddPersonRole] = useState("");
  const [busy, setBusy] = useState(false);

  const [followUpTitle, setFollowUpTitle] = useState("");
  const [followUpDueDate, setFollowUpDueDate] = useState("");
  const [followUpDescription, setFollowUpDescription] = useState("");

  const load = useCallback(async () => {
    if (!recordId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.hseRecord(token, recordId);
      setDetail(data);
      setEditTitle(data.record.title);
      setEditSummary(data.record.summary ?? "");
      setEditDescription(data.record.description ?? "");
      setEditCategory(data.record.categoryCode ?? "");
      setEditSeverity(data.record.severityCode ?? "");
      setEditResponsibleUserId(data.record.responsibleUserId ?? "");

      // HSE evidence documents need hse.documents.read or hse.manage
      try {
        setDocuments(await api.documentsForEntity(token, "hse_record", recordId));
        setDocumentsBlocked(false);
      } catch {
        setDocuments([]);
        setDocumentsBlocked(true);
      }
    } catch (error) {
      setError(error instanceof ApiError ? error.message : "Could not load record.");
    } finally {
      setLoading(false);
    }
  }, [token, recordId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const [categoryList, severityList, userList] = await Promise.all([
          api.configReferenceDataItems(token, "hse_category").catch(() => [] as { code: string; label: string }[]),
          api.configReferenceDataItems(token, "hse_severity").catch(() => [] as { code: string; label: string }[]),
          api.users(token).catch(() => [] as { id: string; email: string; fullName: string }[]),
        ]);
        setCategories(categoryList);
        setSeverities(severityList);
        setUsers(userList);
      } catch {
        // Silent fail for reference data
      }
    })();
  }, [token]);

  if (loading) return <Spinner />;
  if (!detail) return <Alert tone="error">{error || "Record not found"}</Alert>;

  const { record, personsInvolved, followUps, status, availableActions } = detail;

  const categoryLabel = (code: string | null) => categories.find((c) => c.code === code)?.label ?? code ?? "—";
  const severityLabel = (code: string | null) => severities.find((s) => s.code === code)?.label ?? code ?? "—";
  const userLabel = (id: string | null) => users.find((u) => u.id === id)?.fullName ?? "—";

  async function saveEdits() {
    if (!recordId) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateHseRecord(token, recordId, {
        title: editTitle,
        summary: editSummary || null,
        description: editDescription || null,
        categoryCode: editCategory || null,
        severityCode: editSeverity || null,
        responsibleUserId: editResponsibleUserId || null,
      });
      setDetail((d) => (d ? { ...d, record: updated } : null));
      setEditMode(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save changes.");
    } finally {
      setBusy(false);
    }
  }

  async function addPerson() {
    if (!recordId || !addPersonName) return;
    setBusy(true);
    try {
      await api.addHsePersonInvolved(token, recordId, {
        personName: addPersonName,
        personRole: addPersonRole || null,
      });
      setAddPersonName("");
      setAddPersonRole("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add person.");
    } finally {
      setBusy(false);
    }
  }

  async function createFollowUp() {
    if (!recordId || !followUpTitle) return;
    setBusy(true);
    try {
      await api.createHseFollowUp(token, recordId, {
        title: followUpTitle,
        description: followUpDescription || null,
        dueDate: followUpDueDate || null,
      });
      setFollowUpTitle("");
      setFollowUpDueDate("");
      setFollowUpDescription("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create follow-up.");
    } finally {
      setBusy(false);
    }
  }

  async function actOnRecord(actionCode: string) {
    if (!recordId) return;
    setBusy(true);
    try {
      await api.actOnHseRecord(token, recordId, actionCode);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not perform action.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadEvidence(file: File) {
    if (!recordId) return;
    setBusy(true);
    setError(null);
    try {
      await api.uploadDocument(token, "hse_record", recordId, file);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not upload evidence document.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title={record.recordNumber} subtitle={record.title} />

      {error ? <Alert tone="error">{error}</Alert> : null}

      <Card className="flex gap-2">
        {availableActions.map((action) => (
          <Button key={action.actionCode} onClick={() => void actOnRecord(action.actionCode)} disabled={busy}>
            {action.name}
          </Button>
        ))}
      </Card>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <div className="flex gap-4">
          {(["overview", "location", "evidence", "follow-ups", "timeline"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium ${
                activeTab === tab
                  ? "border-b-2 border-blue-600 text-blue-600"
                  : "text-slate-600 hover:text-slate-800"
              }`}
            >
              {tab === "overview" && "Overview"}
              {tab === "location" && "Location"}
              {tab === "evidence" && "Evidence"}
              {tab === "follow-ups" && "Follow-ups"}
              {tab === "timeline" && "Timeline"}
            </button>
          ))}
        </div>
      </div>

      {/* Overview Tab */}
      {activeTab === "overview" && (
        <div className="space-y-4">
          <Card>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-semibold text-slate-600">Type</p>
                    <Badge>{record.recordType === "incident" ? "Incident" : "Observation"}</Badge>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-600">Status</p>
                    {status ? (
                      <StatusPill tone="info">{status.stepName}</StatusPill>
                    ) : (
                      <StatusPill tone="warning">Not Started</StatusPill>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-600">Category</p>
                    <p>{categoryLabel(record.categoryCode)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-600">Severity</p>
                    <p>{severityLabel(record.severityCode)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-600">Occurred</p>
                    <p>{formatDate(record.occurredAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-600">Reported</p>
                    <p>{formatDate(record.reportedAt)}</p>
                  </div>
                </div>
              </div>
              {!editMode && (
                <Button onClick={() => setEditMode(true)} variant="secondary">
                  Edit
                </Button>
              )}
            </div>
          </Card>

          {editMode ? (
            <Card>
              <div className="space-y-3">
                <Field label="Title" required>
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    disabled={busy}
                  />
                </Field>
                <Field label="Summary">
                  <Input
                    value={editSummary}
                    onChange={(e) => setEditSummary(e.target.value)}
                    disabled={busy}
                  />
                </Field>
                <Field label="Description">
                  <Textarea
                    rows={4}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    disabled={busy}
                  />
                </Field>
                <Field label="Category">
                  <Select value={editCategory} onChange={(e) => setEditCategory(e.target.value)} disabled={busy}>
                    <option value="">None</option>
                    {categories.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Severity">
                  <Select value={editSeverity} onChange={(e) => setEditSeverity(e.target.value)} disabled={busy}>
                    <option value="">None</option>
                    {severities.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Responsible User">
                  <Select value={editResponsibleUserId} onChange={(e) => setEditResponsibleUserId(e.target.value)} disabled={busy}>
                    <option value="">None</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.fullName}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="flex gap-2">
                  <Button disabled={busy || !editTitle} onClick={() => void saveEdits()}>
                    Save
                  </Button>
                  <Button variant="secondary" onClick={() => setEditMode(false)} disabled={busy}>
                    Cancel
                  </Button>
                </div>
              </div>
            </Card>
          ) : (
            <Card>
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-semibold text-slate-600">Summary</p>
                  <p>{record.summary || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-600">Description</p>
                  <p className="whitespace-pre-wrap">{record.description || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-600">Immediate Action</p>
                  <p className="whitespace-pre-wrap">{record.immediateAction || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-600">Responsible User</p>
                  <p>{userLabel(record.responsibleUserId)}</p>
                </div>
              </div>
            </Card>
          )}

          {/* Persons Involved */}
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-slate-800">Persons Involved</h3>
            <div className="space-y-3">
              {personsInvolved.length > 0 ? (
                <div className="space-y-2">
                  {personsInvolved.map((p) => (
                    <div key={p.id} className="border-l-2 border-blue-200 bg-blue-50 p-2">
                      <p className="text-sm font-medium">{p.personName || "—"}</p>
                      {p.personRole && <p className="text-xs text-slate-600">{p.personRole}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-600">No persons recorded yet</p>
              )}
              <div className="border-t border-slate-200 pt-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Field label="Name">
                    <Input
                      value={addPersonName}
                      onChange={(e) => setAddPersonName(e.target.value)}
                      placeholder="Person name"
                      disabled={busy}
                    />
                  </Field>
                  <Field label="Role">
                    <Input
                      value={addPersonRole}
                      onChange={(e) => setAddPersonRole(e.target.value)}
                      placeholder="e.g. Operator, Supervisor"
                      disabled={busy}
                    />
                  </Field>
                </div>
                <Button onClick={() => void addPerson()} disabled={busy || !addPersonName} className="mt-2">
                  Add Person
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Location Tab */}
      {activeTab === "location" && (
        <Card>
          <div className="space-y-2">
            <div>
              <p className="text-xs font-semibold text-slate-600">Organization Unit</p>
              <p>{record.organizationUnitId || "—"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-600">Project</p>
              <p>{record.projectId || "—"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-600">Site</p>
              <p>{record.siteId || "—"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-600">Location Detail</p>
              <p>{record.locationDetail || "—"}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Evidence Tab */}
      {activeTab === "evidence" && (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Evidence Documents</h2>
          {documentsBlocked ? (
            <Alert tone="info">
              HSE evidence documents require dedicated permissions (<code>hse.documents.read</code> or <code>hse.manage</code>). Ask an administrator if you need access.
            </Alert>
          ) : (
            <>
              {documents.length === 0 ? (
                <p className="mb-3 text-sm text-slate-500">No evidence documents attached.</p>
              ) : (
                <ul className="mb-3 space-y-1 text-sm text-slate-800">
                  {documents.map((doc) => (
                    <li key={doc.id} className="flex items-center justify-between rounded border border-slate-100 p-2">
                      <span className="font-medium">{doc.fileName}</span>
                      <a
                        href={api.documentDownloadUrl(doc.id)}
                        className="text-xs text-blue-600 hover:underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Download
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <div className="border-t border-slate-100 pt-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  aria-label="Attach HSE evidence document"
                  className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      void uploadEvidence(file);
                    }
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                />
              </div>
            </>
          )}
        </Card>
      )}

      {/* Follow-ups Tab */}
      {activeTab === "follow-ups" && (
        <div className="space-y-4">
          {followUps.length > 0 && (
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-slate-800">Follow-up Actions</h3>
              <div className="space-y-2">
                {followUps.map((fu) => (
                  <div key={fu.id} className="border-l-2 border-orange-200 bg-orange-50 p-3">
                    <p className="text-sm font-medium">{fu.title}</p>
                    {fu.description && <p className="text-xs text-slate-600">{fu.description}</p>}
                    <div className="mt-2 text-xs text-slate-600">
                      {fu.dueDate && <p>Due: {fu.dueDate}</p>}
                      {fu.completedAt ? (
                        <p className="text-green-700">Completed: {formatDateShort(fu.completedAt)}</p>
                      ) : (
                        <p className="text-orange-700">Pending</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <h3 className="mb-3 text-sm font-semibold text-slate-800">Create Follow-up Action</h3>
            <div className="space-y-3">
              <Field label="Title" required>
                <Input
                  value={followUpTitle}
                  onChange={(e) => setFollowUpTitle(e.target.value)}
                  placeholder="Action to be taken"
                  disabled={busy}
                />
              </Field>
              <Field label="Description">
                <Textarea
                  rows={2}
                  value={followUpDescription}
                  onChange={(e) => setFollowUpDescription(e.target.value)}
                  placeholder="Details of the follow-up action"
                  disabled={busy}
                />
              </Field>
              <Field label="Due Date">
                <Input
                  type="date"
                  value={followUpDueDate}
                  onChange={(e) => setFollowUpDueDate(e.target.value)}
                  disabled={busy}
                />
              </Field>
              <Button disabled={busy || !followUpTitle} onClick={() => void createFollowUp()}>
                Create Follow-up
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Timeline Tab */}
      {activeTab === "timeline" && (
        <Card>
          <p className="text-sm text-slate-600">Workflow history and lifecycle events coming soon.</p>
        </Card>
      )}
    </div>
  );
}
