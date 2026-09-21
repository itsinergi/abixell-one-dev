/**
 * Checkpoint 1C.6 — Complaint Administration & Configuration (a section of
 * Administration). Gated on complaint.configure. Manages the reference-data
 * catalogs that drive the Complaint experience (create + activate/deactivate)
 * and shows the numbering, notification templates, and configured workflow
 * read-only — because Core supports only create for those, or editing would
 * require the versioning flow. No fake controls: the backend reports which
 * capabilities are editable.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type ComplaintConfigView,
  type ReferenceItemView,
} from "../../lib/api";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Spinner,
  StatusPill,
} from "../../shell/components/ui";

const REF_TYPES: { typeCode: string; title: string; key: "categories" | "severities" | "priorities" }[] = [
  { typeCode: "complaint_category", title: "Categories", key: "categories" },
  { typeCode: "complaint_severity", title: "Severity", key: "severities" },
  { typeCode: "priority_level", title: "Priority", key: "priorities" },
];

export function ComplaintConfigPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const navigate = useNavigate();

  const [config, setConfig] = useState<ComplaintConfigView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setConfig(await api.complaintConfig(token));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load configuration");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function addItem(typeCode: string, form: HTMLFormElement) {
    const data = new FormData(form);
    setBusy(true);
    setNotice(null);
    try {
      await api.createComplaintRefItem(token, typeCode, {
        code: String(data.get("code")).trim(),
        label: String(data.get("label")).trim(),
      });
      setNotice({ tone: "success", text: "Item added." });
      form.reset();
      await load();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : "Failed to add item" });
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(typeCode: string, item: ReferenceItemView) {
    setBusy(true);
    setNotice(null);
    try {
      await api.setComplaintRefItemActive(token, typeCode, item.id, !item.isActive);
      setNotice({ tone: "success", text: item.isActive ? "Item deactivated." : "Item activated." });
      await load();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError ? err.message : "Failed to update item" });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Loading configuration…" />;
  if (error)
    return (
      <div className="space-y-3">
        <Alert tone="error">{error}</Alert>
        <Button variant="secondary" onClick={() => navigate("/administration")}>
          Back to Administration
        </Button>
      </div>
    );
  if (!config) return null;

  return (
    <div>
      <PageHeader
        title="Complaint Configuration"
        subtitle="Manage the catalogs and settings that drive the complaint experience."
        actions={
          <Button variant="secondary" onClick={() => navigate("/administration")}>
            Back to Administration
          </Button>
        }
      />

      {notice && (
        <div className="mb-4">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}

      {/* Reference Data */}
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Reference Data</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {REF_TYPES.map((rt) => {
            const items = config.referenceData[rt.key];
            return (
              <Card key={rt.typeCode}>
                <h3 className="mb-2 text-sm font-medium text-slate-600">{rt.title}</h3>
                {items.length === 0 ? (
                  <p className="text-sm text-slate-400">No items configured.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm">
                    {items.map((item) => (
                      <li key={item.id} className="flex items-center justify-between py-2">
                        <div className="min-w-0">
                          <div className="truncate text-slate-700">{item.label}</div>
                          <div className="font-mono text-xs text-slate-400">{item.code}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <StatusPill tone={item.isActive ? "success" : "neutral"}>
                            {item.isActive ? "Active" : "Inactive"}
                          </StatusPill>
                          {config.capabilities.referenceDataToggleActive && (
                            <Button variant="ghost" disabled={busy} onClick={() => toggleActive(rt.typeCode, item)}>
                              {item.isActive ? "Deactivate" : "Activate"}
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {config.capabilities.referenceDataCreate && (
                  <form
                    className="mt-3 space-y-2 border-t border-slate-100 pt-3"
                    onSubmit={(e: FormEvent<HTMLFormElement>) => {
                      e.preventDefault();
                      addItem(rt.typeCode, e.currentTarget);
                    }}
                  >
                    <div className="text-xs font-medium text-slate-500">Add {rt.title.toLowerCase()}</div>
                    <Field label={`${rt.title} code`} required>
                      <Input name="code" placeholder="code (e.g. billing)" required />
                    </Field>
                    <Field label={`${rt.title} label`} required>
                      <Input name="label" placeholder="Label (e.g. Billing)" required />
                    </Field>
                    <Button type="submit" disabled={busy}>
                      Add
                    </Button>
                  </form>
                )}
              </Card>
            );
          })}
        </div>
      </section>

      {/* Numbering + Notifications */}
      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Numbering</h2>
          {config.numbering ? (
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs text-slate-400">Pattern</dt>
                <dd className="font-mono text-slate-700">{config.numbering.pattern}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Current sequence</dt>
                <dd className="text-slate-700">{config.numbering.currentSequence}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-slate-400">No numbering sequence configured.</p>
          )}
          {!config.capabilities.numberingEditable && (
            <p className="mt-2 text-xs text-slate-400">Read-only in this release.</p>
          )}
        </Card>

        <Card>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Notification templates</h2>
          {config.notificationTemplates.length === 0 ? (
            <p className="text-sm text-slate-400">No complaint notification templates configured.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {config.notificationTemplates.map((t) => (
                <li key={t.id} className="py-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-slate-600">{t.eventType}</span>
                    <Badge>{t.channel}</Badge>
                  </div>
                  {t.subjectTemplate && <div className="mt-0.5 text-slate-600">{t.subjectTemplate}</div>}
                </li>
              ))}
            </ul>
          )}
          {!config.capabilities.notificationTemplateEditable && (
            <p className="mt-2 text-xs text-slate-400">Read-only in this release.</p>
          )}
        </Card>
      </section>

      {/* Workflow (read-only) */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Workflow lifecycle</h2>
        <Card>
          {config.workflow ? (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-slate-700">{config.workflow.definition.name}</span>
                <Badge>
                  v{config.workflow.versionNumber ?? "—"} · {config.workflow.versionStatus ?? "no published version"}
                </Badge>
                {!config.capabilities.workflowEditable && (
                  <span className="text-xs text-slate-400">Read-only — authored via the workflow engine.</span>
                )}
              </div>
              <p className="mb-1 text-xs text-slate-400 lg:hidden">Scroll to see all workflow columns →</p>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500">Step</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500">SLA (h)</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500">Actions</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500">Assigned to</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {config.workflow.steps.map((s) => (
                      <tr key={s.code}>
                        <td className="px-3 py-2 align-top">
                          <div className="font-medium text-slate-700">{s.name}</div>
                          <div className="font-mono text-xs text-slate-400">
                            {s.code}
                            {s.isInitial ? " · initial" : ""}
                            {s.isTerminal ? ` · terminal (${s.terminalStatus})` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top text-slate-600">{s.slaHours ?? "—"}</td>
                        <td className="px-3 py-2 align-top text-slate-600">
                          {s.transitions.length === 0
                            ? "—"
                            : s.transitions.map((t) => (
                                <div key={t.actionCode}>
                                  {t.name} → {t.toStepCode ?? "?"}
                                  {t.condition ? ` [${t.condition.field} ${t.condition.operator} ${String(t.condition.value)}]` : ""}
                                </div>
                              ))}
                        </td>
                        <td className="px-3 py-2 align-top text-slate-600">
                          {s.assignmentRules.length === 0
                            ? "—"
                            : s.assignmentRules.map((r, i) => (
                                <div key={i}>
                                  {r.assignmentType === "role"
                                    ? `${r.roleCode} (${r.organizationUnitStrategy})`
                                    : `user: ${r.specificUserSource}`}
                                </div>
                              ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400">No workflow definition configured.</p>
          )}
        </Card>
      </section>
    </div>
  );
}
