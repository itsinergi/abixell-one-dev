/**
 * HSE Advanced — Permits & Audit page.
 *
 * Work permits carry no local lifecycle state: the Workflow Engine owns it and
 * the permit only stores `workflowInstanceId` (ADR-0027 §4). This page reads the
 * engine's status and offers the actions it says are available.
 *
 * Audit programmes are scheduled templates; occurrences are the realised
 * inspections and findings are the recorded gaps (ADR-0027 §5).
 */

import { useCallback, useEffect, useState } from "react";
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
  Textarea,
  type Column,
} from "../../shell/components/ui";
import { formatDate, formatDateShort, statusTone } from "../../shared/format";
import { useAuth } from "../../auth/AuthContext";
import {
  ApiError,
  api,
  type AuditChecklistItem,
  type AuditFindingType,
  type AuditProgrammeType,
  type HseAuditFinding,
  type HseAuditOccurrence,
  type HseAuditProgramme,
  type HsePermit,
  type HsePermitDetail,
} from "../../lib/api";

const PERMIT_TYPES = [
  { code: "hot_work", label: "Hot work" },
  { code: "confined_space", label: "Confined space" },
  { code: "work_at_height", label: "Work at height" },
  { code: "electrical_isolation", label: "Electrical isolation" },
  { code: "excavation", label: "Excavation" },
  { code: "general", label: "General" },
];

const FINDING_TYPE_LABEL: Record<AuditFindingType, string> = {
  observation: "Observation",
  nonconformity: "Nonconformity",
  major_nonconformity: "Major nonconformity",
};

const FINDING_TYPE_TONE: Record<AuditFindingType, "neutral" | "warning" | "danger"> = {
  observation: "neutral",
  nonconformity: "warning",
  major_nonconformity: "danger",
};

type ModalState =
  | { kind: "none" }
  | {
      kind: "create-permit";
      permitTypeCode: string;
      title: string;
      description: string;
      locationDetail: string;
      validFrom: string;
      validTo: string;
    }
  | { kind: "permit-detail"; permitId: string }
  | {
      kind: "create-programme";
      code: string;
      name: string;
      programmeType: AuditProgrammeType;
      frequencyDays: string;
      checklist: AuditChecklistItem[];
    }
  | { kind: "programme-detail"; programmeId: string }
  | { kind: "occurrence-detail"; occurrenceId: string; programmeId: string };

const today = () => new Date().toISOString().slice(0, 10);
const nowLocal = () => new Date().toISOString().slice(0, 16);

export function HseAdvancedPermitsAuditPage() {
  const { session } = useAuth();
  const token = session?.accessToken ?? "";

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });

  const [permits, setPermits] = useState<HsePermit[]>([]);
  const [permitDetail, setPermitDetail] = useState<HsePermitDetail | null>(null);
  const [programmes, setProgrammes] = useState<HseAuditProgramme[]>([]);
  const [occurrences, setOccurrences] = useState<HseAuditOccurrence[]>([]);
  const [findings, setFindings] = useState<HseAuditFinding[]>([]);
  const [occurrenceResults, setOccurrenceResults] = useState<Record<string, string>>({});
  const [occurrenceNotes, setOccurrenceNotes] = useState("");
  const [newFinding, setNewFinding] = useState<{ findingType: AuditFindingType; checklistItemCode: string; description: string }>({
    findingType: "observation",
    checklistItemCode: "",
    description: "",
  });

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [p, g] = await Promise.all([api.hseAdvPermits(token), api.hseAdvProgrammes(token)]);
      setPermits(p || []);
      setProgrammes(g || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load permits and audit programmes.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof ApiError ? err.message : fallback);

  const openPermit = async (permitId: string) => {
    setBusy(true);
    setError(null);
    try {
      setPermitDetail(await api.hseAdvPermit(token, permitId));
      setModal({ kind: "permit-detail", permitId });
    } catch (err) {
      fail(err, "Failed to load permit.");
    } finally {
      setBusy(false);
    }
  };

  const createPermit = async () => {
    if (modal.kind !== "create-permit") return;
    if (!modal.permitTypeCode || !modal.title.trim()) {
      setError("Permit type and title are required.");
      return;
    }
    if (!modal.validFrom || !modal.validTo) {
      setError("Validity window is required.");
      return;
    }
    if (modal.validTo <= modal.validFrom) {
      setError("Valid to must be after valid from.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const permit = await api.createHseAdvPermit(token, {
        permitTypeCode: modal.permitTypeCode,
        title: modal.title.trim(),
        description: modal.description.trim() || null,
        locationDetail: modal.locationDetail.trim() || null,
        validFrom: modal.validFrom,
        validTo: modal.validTo,
      });
      setNotice(`Permit ${permit.permitNumber} raised.`);
      setModal({ kind: "none" });
      await load();
    } catch (err) {
      fail(err, "Failed to raise permit.");
    } finally {
      setBusy(false);
    }
  };

  const startLifecycle = async (permitId: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.startHseAdvPermitLifecycle(token, permitId);
      setNotice("Permit lifecycle started.");
      await openPermit(permitId);
      await load();
    } catch (err) {
      fail(err, "Failed to start the permit lifecycle.");
    } finally {
      setBusy(false);
    }
  };

  const actOnPermit = async (permitId: string, actionCode: string) => {
    setBusy(true);
    setError(null);
    try {
      setPermitDetail(await api.actOnHseAdvPermit(token, permitId, actionCode));
      setNotice("Permit action applied.");
      await load();
    } catch (err) {
      fail(err, "Failed to apply the permit action.");
    } finally {
      setBusy(false);
    }
  };

  const createProgramme = async () => {
    if (modal.kind !== "create-programme") return;
    const frequencyDays = Number(modal.frequencyDays);
    if (!modal.code.trim() || !modal.name.trim()) {
      setError("Code and name are required.");
      return;
    }
    if (!Number.isInteger(frequencyDays) || frequencyDays <= 0) {
      setError("Frequency must be a positive whole number of days.");
      return;
    }
    const codes = modal.checklist.map((item) => item.code.trim());
    if (new Set(codes).size !== codes.length) {
      setError("Checklist item codes must be unique.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createHseAdvProgramme(token, {
        code: modal.code.trim(),
        name: modal.name.trim(),
        programmeType: modal.programmeType,
        frequencyDays,
        checklist: modal.checklist
          .filter((item) => item.code.trim() && item.question.trim())
          .map((item) => ({ code: item.code.trim(), question: item.question.trim(), isMandatory: item.isMandatory })),
      });
      setNotice("Audit programme created.");
      setModal({ kind: "none" });
      await load();
    } catch (err) {
      fail(err, "Failed to create the audit programme.");
    } finally {
      setBusy(false);
    }
  };

  const openProgramme = async (programmeId: string) => {
    setBusy(true);
    setError(null);
    try {
      setOccurrences((await api.hseAdvOccurrences(token, programmeId)) || []);
      setModal({ kind: "programme-detail", programmeId });
    } catch (err) {
      fail(err, "Failed to load occurrences.");
    } finally {
      setBusy(false);
    }
  };

  const scheduleOccurrence = async (programmeId: string) => {
    const scheduledFor = window.prompt("Scheduled date (YYYY-MM-DD)", today());
    if (!scheduledFor) return;
    setBusy(true);
    setError(null);
    try {
      await api.scheduleHseAdvOccurrence(token, programmeId, scheduledFor);
      setNotice("Occurrence scheduled.");
      await openProgramme(programmeId);
    } catch (err) {
      fail(err, "Failed to schedule the occurrence.");
    } finally {
      setBusy(false);
    }
  };

  const openOccurrence = async (occurrenceId: string, programmeId: string) => {
    setBusy(true);
    setError(null);
    try {
      setFindings((await api.hseAdvFindings(token, occurrenceId)) || []);
      setOccurrenceResults({});
      setOccurrenceNotes("");
      setNewFinding({ findingType: "observation", checklistItemCode: "", description: "" });
      setModal({ kind: "occurrence-detail", occurrenceId, programmeId });
    } catch (err) {
      fail(err, "Failed to load the occurrence.");
    } finally {
      setBusy(false);
    }
  };

  const completeOccurrence = async (occurrenceId: string, programmeId: string) => {
    const programme = programmes.find((p) => p.id === programmeId);
    if (!programme) return;
    const results = programme.checklist
      .filter((item) => occurrenceResults[item.code])
      .map((item) => ({ itemCode: item.code, result: occurrenceResults[item.code], note: null }));
    const unanswered = programme.checklist.filter(
      (item) => item.isMandatory && !occurrenceResults[item.code],
    );
    if (unanswered.length > 0) {
      setError(`Mandatory items have no result: ${unanswered.map((i) => i.code).join(", ")}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.completeHseAdvOccurrence(token, occurrenceId, { results, notes: occurrenceNotes.trim() || null });
      setNotice("Occurrence completed.");
      await openProgramme(programmeId);
    } catch (err) {
      fail(err, "Failed to complete the occurrence.");
    } finally {
      setBusy(false);
    }
  };

  const addFinding = async (occurrenceId: string) => {
    if (!newFinding.description.trim()) {
      setError("A finding needs a description.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createHseAdvFinding(token, occurrenceId, {
        findingType: newFinding.findingType,
        checklistItemCode: newFinding.checklistItemCode || null,
        description: newFinding.description.trim(),
      });
      setNotice("Finding recorded.");
      setFindings((await api.hseAdvFindings(token, occurrenceId)) || []);
      setNewFinding({ findingType: "observation", checklistItemCode: "", description: "" });
    } catch (err) {
      fail(err, "Failed to record the finding.");
    } finally {
      setBusy(false);
    }
  };

  const permitColumns: Column<HsePermit>[] = [
    { header: "Number", cell: (row) => <span className="font-mono text-sm">{row.permitNumber}</span> },
    { header: "Title", mobileRole: "title", cell: (row) => <span>{row.title}</span> },
    {
      header: "Type",
      cell: (row) => <Badge>{PERMIT_TYPES.find((t) => t.code === row.permitTypeCode)?.label ?? row.permitTypeCode}</Badge>,
    },
    {
      header: "Valid",
      cell: (row) => (
        <span className="text-sm text-ink-dim">
          {formatDateShort(row.validFrom)} → {formatDateShort(row.validTo)}
        </span>
      ),
    },
    {
      header: "Lifecycle",
      mobileRole: "status",
      cell: (row) =>
        row.workflowInstanceId ? (
          <StatusPill tone="info">In workflow</StatusPill>
        ) : (
          <StatusPill tone="neutral">Not started</StatusPill>
        ),
    },
    {
      header: "Actions",
      mobileRole: "detail",
      cell: (row) => (
        <Button variant="secondary" disabled={busy} onClick={() => void openPermit(row.id)}>
          Open
        </Button>
      ),
    },
  ];

  const programmeColumns: Column<HseAuditProgramme>[] = [
    { header: "Code", cell: (row) => <span className="font-mono text-sm">{row.code}</span> },
    { header: "Name", mobileRole: "title", cell: (row) => <span>{row.name}</span> },
    {
      header: "Type",
      cell: (row) => <Badge>{row.programmeType === "audit" ? "Audit" : "Inspection"}</Badge>,
    },
    {
      header: "Frequency",
      className: "text-right",
      cell: (row) => <span className="text-sm">{row.frequencyDays} days</span>,
    },
    {
      header: "Last scheduled",
      cell: (row) => <span className="text-sm text-ink-dim">{row.lastScheduledFor ? formatDateShort(row.lastScheduledFor) : "—"}</span>,
    },
    {
      header: "Status",
      mobileRole: "status",
      cell: (row) => (
        <StatusPill tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Active" : "Inactive"}</StatusPill>
      ),
    },
    {
      header: "Actions",
      mobileRole: "detail",
      cell: (row) => (
        <Button variant="secondary" disabled={busy} onClick={() => void openProgramme(row.id)}>
          Occurrences
        </Button>
      ),
    },
  ];

  const currentProgramme = (programmeId: string) => programmes.find((p) => p.id === programmeId);
  const currentOccurrence = () =>
    modal.kind === "occurrence-detail" ? occurrences.find((o) => o.id === modal.occurrenceId) : undefined;

  return (
    <div className="space-y-4">
      <PageHeader
        title="HSE Permits & Audit"
        subtitle="Work permits driven by the Workflow Engine, plus scheduled audit programmes, their occurrences and findings."
      />

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Work Permits</h2>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  setModal({
                    kind: "create-permit",
                    permitTypeCode: "general",
                    title: "",
                    description: "",
                    locationDetail: "",
                    validFrom: nowLocal(),
                    validTo: nowLocal(),
                  })
                }
              >
                + Permit
              </Button>
            </div>
            <DataTable
              columns={permitColumns}
              rows={permits}
              keyOf={(row) => row.id}
              empty={<EmptyState title="No permits" description="Raise the first work permit." />}
            />
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Audit Programmes</h2>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  setModal({
                    kind: "create-programme",
                    code: "",
                    name: "",
                    programmeType: "inspection",
                    frequencyDays: "30",
                    checklist: [],
                  })
                }
              >
                + Programme
              </Button>
            </div>
            <DataTable
              columns={programmeColumns}
              rows={programmes}
              keyOf={(row) => row.id}
              empty={<EmptyState title="No programmes" description="Create an inspection or audit programme." />}
            />
          </div>
        </div>
      )}

      {modal.kind === "create-permit" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">Raise Permit</h2>
          <div className="space-y-3">
            <Field label="Permit type" required>
              <Select
                value={modal.permitTypeCode}
                onChange={(e) => setModal({ ...modal, permitTypeCode: e.target.value })}
              >
                {PERMIT_TYPES.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Title" required>
              <Input value={modal.title} onChange={(e) => setModal({ ...modal, title: e.target.value })} />
            </Field>
            <Field label="Description">
              <Textarea
                rows={2}
                value={modal.description}
                onChange={(e) => setModal({ ...modal, description: e.target.value })}
              />
            </Field>
            <Field label="Location detail">
              <Input
                value={modal.locationDetail}
                onChange={(e) => setModal({ ...modal, locationDetail: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Valid from" required>
                <Input
                  type="datetime-local"
                  value={modal.validFrom}
                  onChange={(e) => setModal({ ...modal, validFrom: e.target.value })}
                />
              </Field>
              <Field label="Valid to" required>
                <Input
                  type="datetime-local"
                  value={modal.validTo}
                  onChange={(e) => setModal({ ...modal, validTo: e.target.value })}
                />
              </Field>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button disabled={busy} onClick={() => createPermit()}>
              Raise
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setModal({ kind: "none" })}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {modal.kind === "permit-detail" && permitDetail ? (
        <Card>
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-ink">
                {permitDetail.permit.permitNumber} — {permitDetail.permit.title}
              </h2>
              <p className="mt-0.5 text-sm text-ink-dim">
                Valid {formatDate(permitDetail.permit.validFrom)} → {formatDate(permitDetail.permit.validTo)}
              </p>
            </div>
            {permitDetail.status ? (
              <StatusPill tone={statusTone(permitDetail.status.instanceStatus)}>
                {permitDetail.status.stepName ?? permitDetail.status.instanceStatus}
              </StatusPill>
            ) : (
              <StatusPill tone="neutral">Not started</StatusPill>
            )}
          </div>

          {permitDetail.permit.isolationConditions.length > 0 ? (
            <ul className="mb-3 space-y-1 text-sm text-ink-dim">
              {permitDetail.permit.isolationConditions.map((c, i) => (
                <li key={i}>
                  <span className="font-medium text-ink">{c.conditionType}</span> — {c.description}
                  {c.verifiedAt ? ` (verified ${formatDate(c.verifiedAt)})` : " (not verified)"}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {!permitDetail.permit.workflowInstanceId ? (
              <Button disabled={busy} onClick={() => startLifecycle(permitDetail.permit.id)}>
                Start lifecycle
              </Button>
            ) : (
              permitDetail.availableActions.map((action) => (
                <Button
                  key={action.actionCode}
                  disabled={busy}
                  onClick={() => actOnPermit(permitDetail.permit.id, action.actionCode)}
                >
                  {action.name}
                </Button>
              ))
            )}
            <Button variant="ghost" disabled={busy} onClick={() => setModal({ kind: "none" })}>
              Close
            </Button>
          </div>
        </Card>
      ) : null}

      {modal.kind === "create-programme" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">Create Audit Programme</h2>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Code" required>
                <Input value={modal.code} onChange={(e) => setModal({ ...modal, code: e.target.value })} />
              </Field>
              <Field label="Name" required>
                <Input value={modal.name} onChange={(e) => setModal({ ...modal, name: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Type" required>
                <Select
                  value={modal.programmeType}
                  onChange={(e) => setModal({ ...modal, programmeType: e.target.value as AuditProgrammeType })}
                >
                  <option value="inspection">Inspection</option>
                  <option value="audit">Audit</option>
                </Select>
              </Field>
              <Field label="Frequency (days)" required>
                <Input
                  type="number"
                  min={1}
                  value={modal.frequencyDays}
                  onChange={(e) => setModal({ ...modal, frequencyDays: e.target.value })}
                />
              </Field>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ink-dim">Checklist</span>
                <Button
                  variant="secondary"
                  onClick={() =>
                    setModal({
                      ...modal,
                      checklist: [...modal.checklist, { code: "", question: "", isMandatory: true }],
                    })
                  }
                >
                  + Item
                </Button>
              </div>
              {modal.checklist.map((item, index) => (
                <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Input
                    placeholder="Code"
                    value={item.code}
                    onChange={(e) =>
                      setModal({
                        ...modal,
                        checklist: modal.checklist.map((it, i) =>
                          i === index ? { ...it, code: e.target.value } : it,
                        ),
                      })
                    }
                  />
                  <Input
                    placeholder="Question"
                    value={item.question}
                    onChange={(e) =>
                      setModal({
                        ...modal,
                        checklist: modal.checklist.map((it, i) =>
                          i === index ? { ...it, question: e.target.value } : it,
                        ),
                      })
                    }
                  />
                  <label className="flex items-center gap-2 text-sm text-ink-dim">
                    <input
                      type="checkbox"
                      checked={item.isMandatory}
                      onChange={(e) =>
                        setModal({
                          ...modal,
                          checklist: modal.checklist.map((it, i) =>
                            i === index ? { ...it, isMandatory: e.target.checked } : it,
                          ),
                        })
                      }
                    />
                    Mandatory
                  </label>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button disabled={busy} onClick={() => createProgramme()}>
              Create
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setModal({ kind: "none" })}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {modal.kind === "programme-detail" ? (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">
              Occurrences — {currentProgramme(modal.programmeId)?.name ?? ""}
            </h2>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => scheduleOccurrence(modal.programmeId)}>
                + Schedule
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setModal({ kind: "none" })}>
                Close
              </Button>
            </div>
          </div>
          {occurrences.length === 0 ? (
            <EmptyState title="No occurrences" description="Schedule the first inspection." />
          ) : (
            <ul className="divide-y divide-line">
              {occurrences.map((occurrence) => (
                <li key={occurrence.id} className="flex items-center justify-between gap-2 py-2">
                  <div>
                    <div className="text-sm text-ink">{formatDateShort(occurrence.scheduledFor)}</div>
                    <div className="text-xs text-ink-dim">
                      {occurrence.performedAt ? `Performed ${formatDate(occurrence.performedAt)}` : "Not performed"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {occurrence.performedAt ? (
                      <StatusPill tone="success">Complete</StatusPill>
                    ) : (
                      <StatusPill tone="warning">Pending</StatusPill>
                    )}
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void openOccurrence(occurrence.id, modal.programmeId)}
                    >
                      Open
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {modal.kind === "occurrence-detail" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">
            Occurrence {currentOccurrence() ? formatDateShort(currentOccurrence()!.scheduledFor) : ""}
          </h2>

          {currentOccurrence()?.performedAt ? (
            <Alert tone="info">This occurrence is complete; results are frozen.</Alert>
          ) : (
            <div className="space-y-3">
              {(currentProgramme(modal.programmeId)?.checklist ?? []).map((item) => (
                <Field key={item.code} label={item.question} required={item.isMandatory} hint={item.code}>
                  <Select
                    value={occurrenceResults[item.code] ?? ""}
                    onChange={(e) => setOccurrenceResults({ ...occurrenceResults, [item.code]: e.target.value })}
                  >
                    <option value="">Not answered</option>
                    <option value="pass">Pass</option>
                    <option value="fail">Fail</option>
                    <option value="not_applicable">Not applicable</option>
                  </Select>
                </Field>
              ))}
              <Field label="Notes">
                <Textarea rows={2} value={occurrenceNotes} onChange={(e) => setOccurrenceNotes(e.target.value)} />
              </Field>
              <Button disabled={busy} onClick={() => completeOccurrence(modal.occurrenceId, modal.programmeId)}>
                Complete occurrence
              </Button>
            </div>
          )}

          <div className="mt-4 space-y-3 border-t border-line pt-3">
            <h3 className="text-sm font-semibold text-ink">Findings</h3>
            {findings.length === 0 ? (
              <p className="text-sm text-ink-dim">No findings recorded.</p>
            ) : (
              <ul className="space-y-2">
                {findings.map((finding) => (
                  <li key={finding.id} className="text-sm">
                    <StatusPill tone={FINDING_TYPE_TONE[finding.findingType]}>
                      {FINDING_TYPE_LABEL[finding.findingType]}
                    </StatusPill>{" "}
                    <span className="text-ink">{finding.description}</span>
                    {finding.checklistItemCode ? (
                      <span className="ml-1 font-mono text-xs text-ink-dim">[{finding.checklistItemCode}]</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Select
                value={newFinding.findingType}
                onChange={(e) =>
                  setNewFinding({ ...newFinding, findingType: e.target.value as AuditFindingType })
                }
              >
                <option value="observation">Observation</option>
                <option value="nonconformity">Nonconformity</option>
                <option value="major_nonconformity">Major nonconformity</option>
              </Select>
              <Select
                value={newFinding.checklistItemCode}
                onChange={(e) => setNewFinding({ ...newFinding, checklistItemCode: e.target.value })}
              >
                <option value="">No checklist item</option>
                {(currentProgramme(modal.programmeId)?.checklist ?? []).map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.code}
                  </option>
                ))}
              </Select>
              <Button variant="secondary" disabled={busy} onClick={() => addFinding(modal.occurrenceId)}>
                + Finding
              </Button>
            </div>
            <Field label="Finding description">
              <Textarea
                rows={2}
                value={newFinding.description}
                onChange={(e) => setNewFinding({ ...newFinding, description: e.target.value })}
              />
            </Field>
          </div>

          <div className="mt-3">
            <Button variant="ghost" disabled={busy} onClick={() => void openProgramme(modal.programmeId)}>
              Back to occurrences
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
