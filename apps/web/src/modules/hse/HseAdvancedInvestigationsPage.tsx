/**
 * HSE Advanced — Investigations & Risk page.
 *
 * Investigation frameworks (versioned), investigations bound to a Core HSE
 * record, the tenant's risk matrix, and JSA/HIRA assessments.
 *
 * The framework version is copied onto the investigation at creation and never
 * rewritten (ADR-0027 §2); the risk rating is stored on the assessment at
 * assessment time (§3), so editing the matrix never re-rates history.
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
import { formatDate, formatDateShort } from "../../shared/format";
import { useAuth } from "../../auth/AuthContext";
import {
  ApiError,
  api,
  type HseInvestigation,
  type HseInvestigationFramework,
  type HseRecord,
  type HseRiskAssessment,
  type HseRiskMatrix,
  type RiskAssessmentType,
} from "../../lib/api";

type ModalState =
  | { kind: "none" }
  | { kind: "create-framework"; code: string; name: string; description: string; causeCategories: string }
  | { kind: "start-investigation"; recordId: string; frameworkId: string }
  | {
      kind: "conclude-investigation";
      id: string;
      findings: string;
      rootCause: string;
      factors: { category: string; description: string; isRootCause: boolean }[];
    }
  | {
      kind: "create-assessment";
      assessmentType: RiskAssessmentType;
      title: string;
      taskDescription: string;
      likelihood: string;
      severity: string;
    };

const ASSESSMENT_TYPE_LABEL: Record<RiskAssessmentType, string> = {
  jsa: "JSA",
  hira: "HIRA",
};

export function HseAdvancedInvestigationsPage() {
  const { session } = useAuth();
  const token = session?.accessToken ?? "";

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });

  const [frameworks, setFrameworks] = useState<HseInvestigationFramework[]>([]);
  const [investigations, setInvestigations] = useState<HseInvestigation[]>([]);
  const [records, setRecords] = useState<HseRecord[]>([]);
  const [matrix, setMatrix] = useState<HseRiskMatrix | null>(null);
  const [assessments, setAssessments] = useState<HseRiskAssessment[]>([]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [f, i, r, m, a] = await Promise.all([
        api.hseAdvFrameworks(token),
        api.hseAdvInvestigations(token),
        api.hseRecords(token),
        api.hseAdvRiskMatrix(token),
        api.hseAdvRiskAssessments(token),
      ]);
      setFrameworks(f || []);
      setInvestigations(i || []);
      setRecords(r || []);
      setMatrix(m || null);
      setAssessments(a || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load HSE investigations and risk data.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof ApiError ? err.message : fallback);

  const createFramework = async () => {
    if (modal.kind !== "create-framework") return;
    if (!modal.code.trim() || !modal.name.trim()) {
      setError("Code and name are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createHseAdvFramework(token, {
        code: modal.code.trim(),
        name: modal.name.trim(),
        description: modal.description.trim() || null,
        causeCategories: modal.causeCategories
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
      });
      setNotice("Investigation framework created.");
      setModal({ kind: "none" });
      await load();
    } catch (err) {
      fail(err, "Failed to create framework.");
    } finally {
      setBusy(false);
    }
  };

  const startInvestigation = async () => {
    if (modal.kind !== "start-investigation") return;
    if (!modal.recordId || !modal.frameworkId) {
      setError("Pick a record and a framework.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createHseAdvInvestigation(token, modal.recordId, { frameworkId: modal.frameworkId });
      setNotice("Investigation started.");
      setModal({ kind: "none" });
      await load();
    } catch (err) {
      fail(err, "Failed to start investigation.");
    } finally {
      setBusy(false);
    }
  };

  const saveInvestigation = async (conclude: boolean) => {
    if (modal.kind !== "conclude-investigation") return;
    if (conclude && !modal.rootCause.trim()) {
      setError("An investigation cannot conclude without a root cause.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.updateHseAdvInvestigation(token, modal.id, {
        findings: modal.findings.trim() || null,
        rootCause: modal.rootCause.trim() || null,
        contributingFactors: modal.factors,
        concluded: conclude,
      });
      setNotice(conclude ? "Investigation concluded." : "Investigation updated.");
      setModal({ kind: "none" });
      await load();
    } catch (err) {
      fail(err, "Failed to update investigation.");
    } finally {
      setBusy(false);
    }
  };

  const createAssessment = async () => {
    if (modal.kind !== "create-assessment") return;
    const likelihood = Number(modal.likelihood);
    const severity = Number(modal.severity);
    if (!modal.title.trim()) {
      setError("Title is required.");
      return;
    }
    if (!Number.isInteger(likelihood) || !Number.isInteger(severity)) {
      setError("Likelihood and severity must be whole numbers from the matrix scale.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createHseAdvRiskAssessment(token, {
        assessmentType: modal.assessmentType,
        title: modal.title.trim(),
        taskDescription: modal.taskDescription.trim() || null,
        likelihood,
        severity,
      });
      setNotice("Risk assessment recorded.");
      setModal({ kind: "none" });
      await load();
    } catch (err) {
      fail(err, "Failed to record risk assessment.");
    } finally {
      setBusy(false);
    }
  };

  const patchFactor = (index: number, patch: Partial<{ category: string; description: string; isRootCause: boolean }>) => {
    setModal((m) => {
      if (m.kind !== "conclude-investigation") return m;
      const factors = m.factors.map((f, i) => (i === index ? { ...f, ...patch } : f));
      return { ...m, factors };
    });
  };

  const frameworkColumns: Column<HseInvestigationFramework>[] = [
    { header: "Code", cell: (row) => <span className="font-mono text-sm">{row.code}</span> },
    { header: "Name", cell: (row) => <span>{row.name}</span> },
    { header: "Version", className: "text-right", cell: (row) => <span>v{row.version}</span> },
    {
      header: "Cause Categories",
      cell: (row) => (
        <span className="text-sm text-ink-dim">{row.causeCategories.join(", ") || "—"}</span>
      ),
    },
    {
      header: "Status",
      mobileRole: "status",
      cell: (row) => (
        <StatusPill tone={row.isActive ? "success" : "neutral"}>
          {row.isActive ? "Active" : "Inactive"}
        </StatusPill>
      ),
    },
  ];

  const investigationColumns: Column<HseInvestigation>[] = [
    {
      header: "Framework",
      cell: (row) => (
        <span className="text-sm">
          <span className="font-mono">{row.frameworkCode}</span> v{row.frameworkVersion}
        </span>
      ),
    },
    { header: "Started", cell: (row) => <span>{formatDateShort(row.startedAt)}</span> },
    {
      header: "Root Cause",
      cell: (row) => (
        <span className="text-sm text-ink-dim">{row.rootCause || "—"}</span>
      ),
    },
    {
      header: "Status",
      mobileRole: "status",
      cell: (row) =>
        row.concludedAt ? (
          <StatusPill tone="success">Concluded</StatusPill>
        ) : (
          <StatusPill tone="info">Open</StatusPill>
        ),
    },
    {
      header: "Actions",
      mobileRole: "detail",
      cell: (row) => (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            setModal({
              kind: "conclude-investigation",
              id: row.id,
              findings: row.findings ?? "",
              rootCause: row.rootCause ?? "",
              factors: row.contributingFactors,
            })
          }
        >
          Record findings
        </Button>
      ),
    },
  ];

  const assessmentColumns: Column<HseRiskAssessment>[] = [
    {
      header: "Type",
      cell: (row) => <Badge>{ASSESSMENT_TYPE_LABEL[row.assessmentType]}</Badge>,
    },
    { header: "Title", cell: (row) => <span>{row.title}</span> },
    {
      header: "Rating",
      className: "text-right",
      cell: (row) => (
        <span className="font-mono text-sm">
          {row.likelihood} × {row.severity} = {row.score} ({row.bandCode})
        </span>
      ),
    },
    {
      header: "Residual",
      className: "text-right",
      cell: (row) =>
        row.residualScore ? (
          <span className="font-mono text-sm">
            {row.residualScore} ({row.residualBandCode})
          </span>
        ) : (
          <span className="text-sm text-ink-dim">—</span>
        ),
    },
    { header: "Assessed", cell: (row) => <span>{formatDate(row.assessedAt)}</span> },
  ];

  const recordLabel = (recordId: string) => {
    const r = records.find((x) => x.id === recordId);
    return r ? `${r.recordNumber} — ${r.title}` : recordId;
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="HSE Investigations & Risk"
        subtitle="Versioned investigation frameworks, findings and root cause, plus the tenant risk matrix and JSA/HIRA assessments."
      />

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {loading ? (
        <div className="flex items-center justify-center p-8">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Investigation Frameworks</h2>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  setModal({ kind: "create-framework", code: "", name: "", description: "", causeCategories: "" })
                }
              >
                + Framework
              </Button>
            </div>
            <DataTable
              columns={frameworkColumns}
              rows={frameworks}
              keyOf={(row) => row.id}
              empty={<EmptyState title="No frameworks" description="Create the first investigation framework." />}
            />
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Investigations</h2>
              <Button
                variant="secondary"
                disabled={busy || records.length === 0}
                onClick={() => setModal({ kind: "start-investigation", recordId: "", frameworkId: "" })}
              >
                + Investigation
              </Button>
            </div>
            <DataTable
              columns={investigationColumns}
              rows={investigations}
              keyOf={(row) => row.id}
              empty={
                <EmptyState
                  title="No investigations"
                  description="Start one against a Core HSE record."
                />
              }
            />
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Risk Matrix</h2>
            </div>
            {matrix ? (
              <Card>
                <div className="text-sm text-ink">
                  <span className="font-mono">{matrix.code}</span> {matrix.name}
                </div>
                <div className="mt-1 text-sm text-ink-dim">
                  Likelihood {matrix.likelihoodScale.map((p) => p.value).join(" · ")} — severity{" "}
                  {matrix.severityScale.map((p) => p.value).join(" · ")}
                </div>
              </Card>
            ) : (
              <EmptyState
                title="No active risk matrix"
                description="An assessment cannot be rated until the tenant publishes a matrix."
              />
            )}
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">JSA / HIRA Assessments</h2>
              <Button
                variant="secondary"
                disabled={busy || !matrix}
                onClick={() =>
                  setModal({
                    kind: "create-assessment",
                    assessmentType: "jsa",
                    title: "",
                    taskDescription: "",
                    likelihood: "",
                    severity: "",
                  })
                }
              >
                + Assessment
              </Button>
            </div>
            <DataTable
              columns={assessmentColumns}
              rows={assessments}
              keyOf={(row) => row.id}
              empty={<EmptyState title="No assessments" description="Record the first JSA or HIRA." />}
            />
          </div>
        </div>
      )}

      {modal.kind === "create-framework" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">Create Framework</h2>
          <div className="space-y-3">
            <Field label="Code" required>
              <Input
                placeholder="ICAM"
                value={modal.code}
                onChange={(e) => setModal({ ...modal, code: e.target.value })}
              />
            </Field>
            <Field label="Name" required>
              <Input
                placeholder="Incident Cause Analysis Method"
                value={modal.name}
                onChange={(e) => setModal({ ...modal, name: e.target.value })}
              />
            </Field>
            <Field label="Description">
              <Textarea
                rows={2}
                value={modal.description}
                onChange={(e) => setModal({ ...modal, description: e.target.value })}
              />
            </Field>
            <Field label="Cause Categories" hint="Comma separated.">
              <Input
                placeholder="human, equipment, environment, organisation"
                value={modal.causeCategories}
                onChange={(e) => setModal({ ...modal, causeCategories: e.target.value })}
              />
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button disabled={busy} onClick={() => createFramework()}>
              Create
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setModal({ kind: "none" })}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {modal.kind === "start-investigation" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">Start Investigation</h2>
          <div className="space-y-3">
            <Field label="Core HSE Record" required>
              <Select
                value={modal.recordId}
                onChange={(e) => setModal({ ...modal, recordId: e.target.value })}
              >
                <option value="">Select a record</option>
                {records.map((r) => (
                  <option key={r.id} value={r.id}>
                    {recordLabel(r.id)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Framework" required>
              <Select
                value={modal.frameworkId}
                onChange={(e) => setModal({ ...modal, frameworkId: e.target.value })}
              >
                <option value="">Select a framework</option>
                {frameworks
                  .filter((f) => f.isActive)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.code} v{f.version} — {f.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button disabled={busy} onClick={() => startInvestigation()}>
              Start
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setModal({ kind: "none" })}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {modal.kind === "conclude-investigation" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">Record Findings</h2>
          <div className="space-y-3">
            <Field label="Findings">
              <Textarea
                rows={3}
                value={modal.findings}
                onChange={(e) => setModal({ ...modal, findings: e.target.value })}
              />
            </Field>
            <Field label="Root Cause" hint="Required before the investigation can conclude.">
              <Textarea
                rows={2}
                value={modal.rootCause}
                onChange={(e) => setModal({ ...modal, rootCause: e.target.value })}
              />
            </Field>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ink-dim">Contributing Factors</span>
                <Button
                  variant="secondary"
                  onClick={() =>
                    setModal({
                      ...modal,
                      factors: [...modal.factors, { category: "", description: "", isRootCause: false }],
                    })
                  }
                >
                  + Factor
                </Button>
              </div>
              {modal.factors.map((factor, index) => (
                <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Input
                    placeholder="Category"
                    value={factor.category}
                    onChange={(e) => patchFactor(index, { category: e.target.value })}
                  />
                  <Input
                    placeholder="Description"
                    value={factor.description}
                    onChange={(e) => patchFactor(index, { description: e.target.value })}
                  />
                  <label className="flex items-center gap-2 text-sm text-ink-dim">
                    <input
                      type="checkbox"
                      checked={factor.isRootCause}
                      onChange={(e) => patchFactor(index, { isRootCause: e.target.checked })}
                    />
                    Root cause
                  </label>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button disabled={busy} onClick={() => saveInvestigation(true)}>
              Save & conclude
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => saveInvestigation(false)}>
              Save draft
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setModal({ kind: "none" })}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {modal.kind === "create-assessment" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">Record Risk Assessment</h2>
          <div className="space-y-3">
            <Field label="Type" required>
              <Select
                value={modal.assessmentType}
                onChange={(e) =>
                  setModal({ ...modal, assessmentType: e.target.value as RiskAssessmentType })
                }
              >
                <option value="jsa">JSA — Job Safety Analysis</option>
                <option value="hira">HIRA — Hazard Identification & Risk Assessment</option>
              </Select>
            </Field>
            <Field label="Title" required>
              <Input value={modal.title} onChange={(e) => setModal({ ...modal, title: e.target.value })} />
            </Field>
            <Field label="Task Description">
              <Textarea
                rows={2}
                value={modal.taskDescription}
                onChange={(e) => setModal({ ...modal, taskDescription: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Likelihood" required>
                <Select
                  value={modal.likelihood}
                  onChange={(e) => setModal({ ...modal, likelihood: e.target.value })}
                >
                  <option value="">Select</option>
                  {(matrix?.likelihoodScale ?? []).map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.value} — {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Severity" required>
                <Select
                  value={modal.severity}
                  onChange={(e) => setModal({ ...modal, severity: e.target.value })}
                >
                  <option value="">Select</option>
                  {(matrix?.severityScale ?? []).map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.value} — {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button disabled={busy} onClick={() => createAssessment()}>
              Record
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setModal({ kind: "none" })}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
