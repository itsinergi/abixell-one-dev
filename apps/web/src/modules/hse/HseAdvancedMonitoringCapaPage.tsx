/**
 * HSE Advanced — Monitoring & CAPA page.
 *
 * Monitoring points measure one parameter against a threshold; the breach flag
 * is computed and stored at write time so history keeps its verdict even if the
 * threshold is later widened (ADR-0027 §6).
 *
 * CAPA is deliberately separate from Core follow-up: it may anchor to an HSE
 * record, an investigation, an audit finding, a monitoring reading, or a Core
 * follow-up by reference only (ADR-0027 §1). At least one anchor is required.
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
  type CapaActionType,
  type CapaStatus,
  type HseCapa,
  type HseCapaDetail,
  type HseIndicatorSnapshot,
  type HseMonitoringPoint,
  type HseMonitoringReading,
} from "../../lib/api";

const DECIMAL = /^-?\d{1,16}(\.\d{1,4})?$/;

const CAPA_STATUS_TONE: Record<CapaStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  open: "warning",
  in_progress: "info",
  verification: "info",
  closed: "success",
  cancelled: "neutral",
};

const CAPA_STATUS_LABEL: Record<CapaStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  verification: "Verification",
  closed: "Closed",
  cancelled: "Cancelled",
};

const CAPA_STATUSES: CapaStatus[] = ["open", "in_progress", "verification", "closed", "cancelled"];

type ModalState =
  | { kind: "none" }
  | {
      kind: "create-point";
      code: string;
      name: string;
      parameterCode: string;
      unit: string;
      thresholdMin: string;
      thresholdMax: string;
    }
  | { kind: "point-detail"; pointId: string }
  | {
      kind: "create-capa";
      title: string;
      description: string;
      actionType: CapaActionType;
      anchorKind: "hseRecordId" | "investigationId" | "auditFindingId" | "monitoringReadingId" | "coreFollowUpId";
      anchorValue: string;
      rootCause: string;
      dueDate: string;
    }
  | { kind: "capa-detail"; capaId: string };

const nowLocal = () => new Date().toISOString().slice(0, 16);

export function HseAdvancedMonitoringCapaPage() {
  const { session } = useAuth();
  const token = session?.accessToken ?? "";

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });

  const [points, setPoints] = useState<HseMonitoringPoint[]>([]);
  const [readings, setReadings] = useState<HseMonitoringReading[]>([]);
  const [capas, setCapas] = useState<HseCapa[]>([]);
  const [capaDetail, setCapaDetail] = useState<HseCapaDetail | null>(null);
  const [indicators, setIndicators] = useState<HseIndicatorSnapshot[]>([]);
  const [readingForm, setReadingForm] = useState({ measuredAt: nowLocal(), value: "", note: "" });
  const [actionForm, setActionForm] = useState({ description: "", dueDate: "" });

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [p, c, i] = await Promise.all([
        api.hseAdvMonitoringPoints(token),
        api.hseAdvCapas(token),
        api.hseAdvIndicators(token),
      ]);
      setPoints(p || []);
      setCapas(c || []);
      setIndicators(i || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load monitoring and CAPA data.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof ApiError ? err.message : fallback);

  const createPoint = async () => {
    if (modal.kind !== "create-point") return;
    if (!modal.code.trim() || !modal.name.trim() || !modal.parameterCode.trim() || !modal.unit.trim()) {
      setError("Code, name, parameter and unit are required.");
      return;
    }
    const min = modal.thresholdMin.trim();
    const max = modal.thresholdMax.trim();
    if (!min && !max) {
      setError("A monitoring point needs at least one threshold.");
      return;
    }
    if ((min && !DECIMAL.test(min)) || (max && !DECIMAL.test(max))) {
      setError("Thresholds must be decimal numbers with at most four decimal places.");
      return;
    }
    if (min && max && Number(max) < Number(min)) {
      setError("Threshold max must not be below threshold min.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createHseAdvMonitoringPoint(token, {
        code: modal.code.trim(),
        name: modal.name.trim(),
        parameterCode: modal.parameterCode.trim(),
        unit: modal.unit.trim(),
        thresholdMin: min || null,
        thresholdMax: max || null,
      });
      setNotice("Monitoring point created.");
      setModal({ kind: "none" });
      await load();
    } catch (err) {
      fail(err, "Failed to create the monitoring point.");
    } finally {
      setBusy(false);
    }
  };

  const openPoint = async (pointId: string) => {
    setBusy(true);
    setError(null);
    try {
      setReadings((await api.hseAdvReadings(token, pointId)) || []);
      setReadingForm({ measuredAt: nowLocal(), value: "", note: "" });
      setModal({ kind: "point-detail", pointId });
    } catch (err) {
      fail(err, "Failed to load readings.");
    } finally {
      setBusy(false);
    }
  };

  const recordReading = async (pointId: string) => {
    if (!DECIMAL.test(readingForm.value.trim())) {
      setError("Reading must be a decimal number with at most four decimal places.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.recordHseAdvReading(token, pointId, {
        measuredAt: readingForm.measuredAt,
        value: readingForm.value.trim(),
        note: readingForm.note.trim() || null,
      });
      setNotice("Reading recorded.");
      setReadingForm({ measuredAt: nowLocal(), value: "", note: "" });
      setReadings((await api.hseAdvReadings(token, pointId)) || []);
    } catch (err) {
      fail(err, "Failed to record the reading.");
    } finally {
      setBusy(false);
    }
  };

  const createCapa = async () => {
    if (modal.kind !== "create-capa") return;
    if (!modal.title.trim()) {
      setError("Title is required.");
      return;
    }
    if (!modal.anchorValue.trim()) {
      setError("A CAPA must anchor to a record, investigation, finding, reading, or follow-up.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        title: modal.title.trim(),
        description: modal.description.trim() || null,
        actionType: modal.actionType,
        rootCause: modal.rootCause.trim() || null,
        dueDate: modal.dueDate || null,
        [modal.anchorKind]: modal.anchorValue.trim(),
      };
      await api.createHseAdvCapa(token, body);
      setNotice("CAPA raised.");
      setModal({ kind: "none" });
      await load();
    } catch (err) {
      fail(err, "Failed to raise the CAPA.");
    } finally {
      setBusy(false);
    }
  };

  const openCapa = async (capaId: string) => {
    setBusy(true);
    setError(null);
    try {
      setCapaDetail(await api.hseAdvCapa(token, capaId));
      setActionForm({ description: "", dueDate: "" });
      setModal({ kind: "capa-detail", capaId });
    } catch (err) {
      fail(err, "Failed to load the CAPA.");
    } finally {
      setBusy(false);
    }
  };

  const changeCapaStatus = async (capaId: string, status: CapaStatus) => {
    setBusy(true);
    setError(null);
    try {
      await api.changeHseAdvCapaStatus(token, capaId, { status });
      setCapaDetail(await api.hseAdvCapa(token, capaId));
      setNotice("CAPA status changed.");
      await load();
    } catch (err) {
      fail(err, "Failed to change the CAPA status.");
    } finally {
      setBusy(false);
    }
  };

  const addAction = async (capaId: string) => {
    if (!actionForm.description.trim()) {
      setError("An action needs a description.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.addHseAdvCapaAction(token, capaId, {
        description: actionForm.description.trim(),
        dueDate: actionForm.dueDate || null,
      });
      setCapaDetail(await api.hseAdvCapa(token, capaId));
      setActionForm({ description: "", dueDate: "" });
      setNotice("Action added.");
    } catch (err) {
      fail(err, "Failed to add the action.");
    } finally {
      setBusy(false);
    }
  };

  const completeAction = async (capaId: string, actionId: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.completeHseAdvCapaAction(token, capaId, actionId, {});
      setCapaDetail(await api.hseAdvCapa(token, capaId));
      setNotice("Action completed.");
    } catch (err) {
      fail(err, "Failed to complete the action.");
    } finally {
      setBusy(false);
    }
  };

  const pointColumns: Column<HseMonitoringPoint>[] = [
    { header: "Code", cell: (row) => <span className="font-mono text-sm">{row.code}</span> },
    { header: "Name", mobileRole: "title", cell: (row) => <span>{row.name}</span> },
    { header: "Parameter", cell: (row) => <span className="text-sm text-ink-dim">{row.parameterCode}</span> },
    {
      header: "Threshold",
      className: "text-right",
      cell: (row) => (
        <span className="font-mono text-sm">
          {row.thresholdMin ?? "−∞"} … {row.thresholdMax ?? "+∞"} {row.unit}
        </span>
      ),
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
        <Button variant="secondary" disabled={busy} onClick={() => void openPoint(row.id)}>
          Readings
        </Button>
      ),
    },
  ];

  const capaColumns: Column<HseCapa>[] = [
    { header: "Number", cell: (row) => <span className="font-mono text-sm">{row.capaNumber}</span> },
    { header: "Title", mobileRole: "title", cell: (row) => <span>{row.title}</span> },
    { header: "Type", cell: (row) => <Badge>{row.actionType === "preventive" ? "Preventive" : "Corrective"}</Badge> },
    {
      header: "Due",
      cell: (row) => <span className="text-sm text-ink-dim">{row.dueDate ? formatDateShort(row.dueDate) : "—"}</span>,
    },
    {
      header: "Status",
      mobileRole: "status",
      cell: (row) => <StatusPill tone={CAPA_STATUS_TONE[row.status]}>{CAPA_STATUS_LABEL[row.status]}</StatusPill>,
    },
    {
      header: "Actions",
      mobileRole: "detail",
      cell: (row) => (
        <Button variant="secondary" disabled={busy} onClick={() => void openCapa(row.id)}>
          Open
        </Button>
      ),
    },
  ];

  const indicatorColumns: Column<HseIndicatorSnapshot>[] = [
    {
      header: "Window",
      cell: (row) => (
        <span className="text-sm">
          {formatDateShort(row.windowStart)} → {formatDateShort(row.windowEnd)}
        </span>
      ),
    },
    {
      header: "Exposure hours",
      className: "text-right",
      cell: (row) => <span className="font-mono text-sm">{row.exposureHours ?? "—"}</span>,
    },
    {
      header: "Incidents / LTI",
      className: "text-right",
      cell: (row) => <span className="font-mono text-sm">{row.incidentCount} / {row.lostTimeIncidentCount}</span>,
    },
    {
      header: "IFR",
      className: "text-right",
      cell: (row) => <span className="font-mono text-sm">{row.incidentFrequencyRate ?? "—"}</span>,
    },
    {
      header: "Severity rate",
      className: "text-right",
      cell: (row) => <span className="font-mono text-sm">{row.severityRate ?? "—"}</span>,
    },
    {
      header: "CAPA closure",
      className: "text-right",
      cell: (row) => <span className="font-mono text-sm">{row.capaClosureRate ?? "—"}</span>,
    },
  ];

  const currentPoint = () => (modal.kind === "point-detail" ? points.find((p) => p.id === modal.pointId) : undefined);

  return (
    <div className="space-y-4">
      <PageHeader
        title="HSE Monitoring & CAPA"
        subtitle="Threshold monitoring with breach flags, corrective and preventive actions, and the frozen indicator snapshots derived from them."
      />

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Monitoring Points</h2>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  setModal({
                    kind: "create-point",
                    code: "",
                    name: "",
                    parameterCode: "",
                    unit: "",
                    thresholdMin: "",
                    thresholdMax: "",
                  })
                }
              >
                + Point
              </Button>
            </div>
            <DataTable
              columns={pointColumns}
              rows={points}
              keyOf={(row) => row.id}
              empty={<EmptyState title="No monitoring points" description="Define the first parameter to watch." />}
            />
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">CAPA</h2>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  setModal({
                    kind: "create-capa",
                    title: "",
                    description: "",
                    actionType: "corrective",
                    anchorKind: "hseRecordId",
                    anchorValue: "",
                    rootCause: "",
                    dueDate: "",
                  })
                }
              >
                + CAPA
              </Button>
            </div>
            <DataTable
              columns={capaColumns}
              rows={capas}
              keyOf={(row) => row.id}
              empty={<EmptyState title="No CAPA" description="Raise the first corrective action." />}
            />
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold text-ink">Indicator Snapshots</h2>
            <DataTable
              columns={indicatorColumns}
              rows={indicators}
              keyOf={(row) => row.id}
              empty={
                <EmptyState
                  title="No snapshots"
                  description="Indicators are frozen per window; nothing has been computed yet."
                />
              }
            />
          </div>
        </div>
      )}

      {modal.kind === "create-point" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">Create Monitoring Point</h2>
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
              <Field label="Parameter code" required hint="e.g. noise_dba, dust_mg_m3">
                <Input
                  value={modal.parameterCode}
                  onChange={(e) => setModal({ ...modal, parameterCode: e.target.value })}
                />
              </Field>
              <Field label="Unit" required>
                <Input value={modal.unit} onChange={(e) => setModal({ ...modal, unit: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Threshold min" hint="Leave empty for no lower bound.">
                <Input
                  inputMode="decimal"
                  value={modal.thresholdMin}
                  onChange={(e) => setModal({ ...modal, thresholdMin: e.target.value })}
                />
              </Field>
              <Field label="Threshold max" hint="Leave empty for no upper bound.">
                <Input
                  inputMode="decimal"
                  value={modal.thresholdMax}
                  onChange={(e) => setModal({ ...modal, thresholdMax: e.target.value })}
                />
              </Field>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button disabled={busy} onClick={() => createPoint()}>
              Create
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setModal({ kind: "none" })}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {modal.kind === "point-detail" ? (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">
              Readings — {currentPoint()?.name ?? ""} ({currentPoint()?.unit ?? ""})
            </h2>
            <Button variant="ghost" disabled={busy} onClick={() => setModal({ kind: "none" })}>
              Close
            </Button>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Field label="Measured at" required>
              <Input
                type="datetime-local"
                value={readingForm.measuredAt}
                onChange={(e) => setReadingForm({ ...readingForm, measuredAt: e.target.value })}
              />
            </Field>
            <Field label="Value" required>
              <Input
                inputMode="decimal"
                value={readingForm.value}
                onChange={(e) => setReadingForm({ ...readingForm, value: e.target.value })}
              />
            </Field>
            <Field label="Note">
              <Input
                value={readingForm.note}
                onChange={(e) => setReadingForm({ ...readingForm, note: e.target.value })}
              />
            </Field>
            <div className="flex items-end">
              <Button disabled={busy} onClick={() => recordReading(modal.pointId)}>
                Record reading
              </Button>
            </div>
          </div>

          {readings.length === 0 ? (
            <EmptyState title="No readings" description="Record the first measurement." />
          ) : (
            <ul className="divide-y divide-line">
              {readings.map((reading) => (
                <li key={reading.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="text-ink-dim">{formatDate(reading.measuredAt)}</span>
                  <span className="font-mono text-ink">
                    {reading.value} {currentPoint()?.unit ?? ""}
                  </span>
                  {reading.isBreach ? (
                    <StatusPill tone="danger">Breach</StatusPill>
                  ) : (
                    <StatusPill tone="success">Within</StatusPill>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {modal.kind === "create-capa" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">Raise CAPA</h2>
          <div className="space-y-3">
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Action type" required>
                <Select
                  value={modal.actionType}
                  onChange={(e) => setModal({ ...modal, actionType: e.target.value as CapaActionType })}
                >
                  <option value="corrective">Corrective</option>
                  <option value="preventive">Preventive</option>
                </Select>
              </Field>
              <Field label="Due date">
                <Input type="date" value={modal.dueDate} onChange={(e) => setModal({ ...modal, dueDate: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Anchored to" required hint="At least one anchor is required.">
                <Select
                  value={modal.anchorKind}
                  onChange={(e) =>
                    setModal({
                      ...modal,
                      anchorKind: e.target.value as typeof modal.anchorKind,
                      anchorValue: "",
                    })
                  }
                >
                  <option value="hseRecordId">HSE record</option>
                  <option value="investigationId">Investigation</option>
                  <option value="auditFindingId">Audit finding</option>
                  <option value="monitoringReadingId">Monitoring reading</option>
                  <option value="coreFollowUpId">Core follow-up</option>
                </Select>
              </Field>
              <Field label="Anchor ID" required>
                <Input
                  value={modal.anchorValue}
                  onChange={(e) => setModal({ ...modal, anchorValue: e.target.value })}
                  placeholder="Paste the referenced ID"
                />
              </Field>
            </div>
            <Field label="Root cause">
              <Textarea
                rows={2}
                value={modal.rootCause}
                onChange={(e) => setModal({ ...modal, rootCause: e.target.value })}
              />
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button disabled={busy} onClick={() => createCapa()}>
              Raise
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setModal({ kind: "none" })}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {modal.kind === "capa-detail" && capaDetail ? (
        <Card>
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-ink">
                {capaDetail.capa.capaNumber} — {capaDetail.capa.title}
              </h2>
              <p className="mt-0.5 text-sm text-ink-dim">
                {capaDetail.capa.rootCause ?? "No root cause recorded"}
              </p>
            </div>
            <StatusPill tone={CAPA_STATUS_TONE[capaDetail.capa.status]}>
              {CAPA_STATUS_LABEL[capaDetail.capa.status]}
            </StatusPill>
          </div>

          <div className="mb-4 flex flex-wrap items-end gap-2">
            <Field label="Change status">
              <Select
                value={capaDetail.capa.status}
                disabled={busy}
                onChange={(e) => changeCapaStatus(capaDetail.capa.id, e.target.value as CapaStatus)}
              >
                {CAPA_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {CAPA_STATUS_LABEL[status]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="space-y-3 border-t border-line pt-3">
            <h3 className="text-sm font-semibold text-ink">Actions</h3>
            {capaDetail.actions.length === 0 ? (
              <p className="text-sm text-ink-dim">No actions yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {capaDetail.actions.map((action) => (
                  <li key={action.id} className="flex items-center justify-between gap-2 py-2">
                    <div>
                      <div className="text-sm text-ink">{action.description}</div>
                      <div className="text-xs text-ink-dim">
                        {action.dueDate ? `Due ${formatDateShort(action.dueDate)}` : "No due date"}
                      </div>
                    </div>
                    {action.completedAt ? (
                      <StatusPill tone="success">Done</StatusPill>
                    ) : (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => completeAction(capaDetail.capa.id, action.id)}
                      >
                        Complete
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Field label="New action">
                <Input
                  value={actionForm.description}
                  onChange={(e) => setActionForm({ ...actionForm, description: e.target.value })}
                />
              </Field>
              <Field label="Due date">
                <Input
                  type="date"
                  value={actionForm.dueDate}
                  onChange={(e) => setActionForm({ ...actionForm, dueDate: e.target.value })}
                />
              </Field>
              <div className="flex items-end">
                <Button
                  variant="secondary"
                  disabled={busy || capaDetail.capa.status === "closed" || capaDetail.capa.status === "cancelled"}
                  onClick={() => addAction(capaDetail.capa.id)}
                >
                  + Action
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-3">
            <Button variant="ghost" disabled={busy} onClick={() => setModal({ kind: "none" })}>
              Close
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
