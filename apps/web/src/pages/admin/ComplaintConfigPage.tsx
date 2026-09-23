/**
 * Checkpoint 1C.6 — Complaint Administration & Configuration (a section of
 * Administration). Gated on complaint.configure. Manages the reference-data
 * catalogs that drive the Complaint experience (create + activate/deactivate)
 * and shows the numbering, notification templates, and configured workflow
 * read-only — because Core supports only create for those, or editing would
 * require the versioning flow. No fake controls: the backend reports which
 * capabilities are editable.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
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
  DataTable,
  type Column,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Spinner,
  StatusPill,
} from "../../shell/components/ui";
import { OverlayDialog } from "../../shell/components/OverlayDialog";

function configErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status === 401) return "Your session has expired. Sign in again to continue.";
  if (err instanceof ApiError && err.status === 403) return "Access denied. This operation requires complaint.configure permission.";
  return err instanceof ApiError ? err.message : fallback;
}

const REF_TYPES: { typeCode: string; title: string; singular: string; key: "categories" | "severities" | "priorities" }[] = [
  { typeCode: "complaint_category", title: "Categories", singular: "category", key: "categories" },
  { typeCode: "complaint_severity", title: "Severity", singular: "severity", key: "severities" },
  { typeCode: "priority_level", title: "Priority", singular: "priority", key: "priorities" },
];

export function ComplaintConfigPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const navigate = useNavigate();

  const [config, setConfig] = useState<ComplaintConfigView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState<
    | { kind: "create"; typeCode: string }
    | { kind: "toggle"; typeCode: string; item: ReferenceItemView }
    | null
  >(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const loadRequestRef = useRef(0);
  const dialogRequestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const nextConfig = await api.complaintConfig(token);
      if (loadRequestRef.current === requestId) setConfig(nextConfig);
    } catch (err) {
      if (loadRequestRef.current !== requestId) return;
      setError(configErrorMessage(err, "Failed to load configuration."));
    } finally {
      if (loadRequestRef.current === requestId) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    setConfig(null);
    setDialog(null);
    setDialogError(null);
    setNotice(null);
    setQueries({});
    pendingRef.current = false;
    setPending(false);
    void load();
    // Existing API methods do not accept AbortSignal. Invalidate both read
    // and mutation completions on unmount or session change instead.
    return () => {
      loadRequestRef.current += 1;
      dialogRequestRef.current += 1;
    };
  }, [load]);

  function openCreateDialog(typeCode: string, button: HTMLButtonElement) {
    if (pendingRef.current || loading || error || !config?.capabilities.referenceDataCreate) return;
    triggerRef.current = button;
    dialogRequestRef.current += 1;
    setDialog({ kind: "create", typeCode });
    setDialogError(null);
  }

  function openToggleDialog(typeCode: string, item: ReferenceItemView, button: HTMLButtonElement) {
    if (pendingRef.current || loading || error || !config?.capabilities.referenceDataToggleActive) return;
    triggerRef.current = button;
    dialogRequestRef.current += 1;
    setDialog({ kind: "toggle", typeCode, item });
    setDialogError(null);
  }

  function closeDialog() {
    if (pendingRef.current) return;
    dialogRequestRef.current += 1;
    setDialog(null);
    setDialogError(null);
  }

  async function submitDialog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog || pendingRef.current || loading || error || !config) return;
    const allowed = dialog.kind === "create"
      ? config.capabilities.referenceDataCreate
      : config.capabilities.referenceDataToggleActive;
    if (!allowed) return;
    // Capture form values before awaiting; lock synchronously before React renders.
    const data = new FormData(event.currentTarget);
    const code = String(data.get("code") ?? "").trim();
    const label = String(data.get("label") ?? "").trim();
    if (dialog.kind === "create" && (!code || !label)) {
      setDialogError("Code and label are required.");
      return;
    }
    const requestId = ++dialogRequestRef.current;
    pendingRef.current = true;
    setPending(true);
    setDialogError(null);
    setNotice(null);
    try {
      const item = dialog.kind === "create"
        ? await api.createComplaintRefItem(token, dialog.typeCode, { code, label })
        : await api.setComplaintRefItemActive(token, dialog.typeCode, dialog.item.id, !dialog.item.isActive);
      if (dialogRequestRef.current !== requestId) return;
      setNotice(dialog.kind === "create" ? "Item created." : `Item ${item.isActive ? "activated" : "deactivated"}.`);
      // Refresh errors belong to the page, not the successful mutation dialog.
      // Keep the trigger mounted while refreshing so OverlayDialog restores focus.
      await load();
      if (dialogRequestRef.current !== requestId) return;
      setDialog(null);
    } catch (err) {
      if (dialogRequestRef.current === requestId) {
        setDialogError(configErrorMessage(err, "Failed to save the item."));
      }
    } finally {
      if (dialogRequestRef.current === requestId) {
        pendingRef.current = false;
        setPending(false);
      }
    }
  }

  if (loading && !config) return <Spinner label="Loading configuration…" />;
  if (!config) {
    return (
      <div className="space-y-3">
        <Alert tone="error">{error ?? "Configuration is unavailable."}</Alert>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void load()}>Retry</Button>
          <Button variant="secondary" onClick={() => navigate("/administration")}>
            Back to Administration
          </Button>
        </div>
      </div>
    );
  }
  const actionsDisabled = pending || loading || error !== null;
  const selectedType = REF_TYPES.find((rt) => rt.typeCode === dialog?.typeCode);
  const actionLabel = dialog?.kind === "toggle" ? (dialog.item.isActive ? "Deactivate" : "Activate") : "Create";

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

      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      {notice && (
        <div className="mb-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}

      {/* Reference Data */}
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Reference Data</h2>
        <div className="space-y-6">
          {REF_TYPES.map((rt) => {
            const items = config.referenceData[rt.key];
            const query = queries[rt.typeCode] ?? "";
            const normalizedQuery = query.trim().toLocaleLowerCase();
            const visibleItems = normalizedQuery
              ? items.filter((item) => `${item.code} ${item.label}`.toLocaleLowerCase().includes(normalizedQuery))
              : items;
            const columns: Column<ReferenceItemView>[] = [
              {
                header: "Code",
                cell: (item) => <code className="font-mono text-xs text-slate-600">{item.code}</code>,
                mobileRole: "title",
              },
              {
                header: "Label",
                cell: (item) => item.label,
              },
              {
                header: "Status",
                cell: (item) =>
                  item.isActive ? (
                    <StatusPill tone="success">Active</StatusPill>
                  ) : (
                    <StatusPill tone="neutral">Inactive</StatusPill>
                  ),
                mobileRole: "status",
              },
              {
                header: "Action",
                cell: (item) =>
                  config.capabilities.referenceDataToggleActive ? (
                    <Button
                      variant="ghost"
                      className="w-full sm:w-auto"
                      disabled={actionsDisabled}
                      onClick={(event) => {
                        openToggleDialog(rt.typeCode, item, event.currentTarget);
                      }}
                    >
                      {item.isActive ? "Deactivate" : "Activate"}
                    </Button>
                  ) : null,
                className: "text-right",
              },
            ];

            return (
              <Card key={rt.typeCode}>
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">{rt.title}</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Showing {visibleItems.length} of {items.length} loaded item{items.length !== 1 ? "s" : ""}. Search is limited to this loaded configuration.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <Field label={`Search ${rt.title.toLowerCase()}`}>
                      <Input
                        type="search"
                        placeholder="Search code or label"
                        value={query}
                        onChange={(event) => setQueries((prev) => ({ ...prev, [rt.typeCode]: event.target.value }))}
                        disabled={loading}
                        autoComplete="off"
                      />
                    </Field>
                    {config.capabilities.referenceDataCreate && (
                      <Button
                        variant="primary"
                        disabled={actionsDisabled}
                        onClick={(event) => {
                          openCreateDialog(rt.typeCode, event.currentTarget);
                        }}
                      >
                        Create {rt.singular}
                      </Button>
                    )}
                  </div>
                </div>
                <DataTable
                  columns={columns}
                  rows={visibleItems}
                  keyOf={(item) => item.id}
                  mobileBreakpoint="md"
                  empty={
                    <EmptyState
                      title={items.length === 0 ? `No ${rt.title.toLowerCase()} configured` : "No matching items"}
                      description={
                        items.length === 0
                          ? `Create the first ${rt.singular} to get started.`
                          : "Try a different search term or clear the filter."
                      }
                      action={
                        items.length === 0 && config.capabilities.referenceDataCreate ? (
                          <Button
                            variant="primary"
                            disabled={actionsDisabled}
                            onClick={(event) => {
                              openCreateDialog(rt.typeCode, event.currentTarget);
                            }}
                          >
                            Create {rt.singular}
                          </Button>
                        ) : undefined
                      }
                    />
                  }
                />
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

      {loading && <Spinner label="Refreshing configuration…" />}
      <OverlayDialog
        open={dialog !== null}
        title={dialog?.kind === "toggle" ? `${actionLabel} item` : `Create ${selectedType?.singular ?? "item"}`}
        description={
          dialog?.kind === "toggle"
            ? `Are you sure you want to ${actionLabel.toLowerCase()} “${dialog.item.label}”?`
            : "Add a new reference item to the catalog."
        }
        pending={pending}
        onClose={closeDialog}
        restoreFocusRef={triggerRef}
        footer={
          <>
            <Button variant="secondary" onClick={closeDialog} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="complaint-config-item-form" disabled={actionsDisabled}>
              {pending ? "Saving…" : actionLabel}
            </Button>
          </>
        }
      >
        {dialogError && (
          <div className="mb-4">
            <Alert tone="error">{dialogError}</Alert>
          </div>
        )}
        <form id="complaint-config-item-form" className="space-y-4" onSubmit={submitDialog}>
          {dialog?.kind === "create" ? (
            <>
              <Field label="Code" required hint="Internal identifier (e.g., billing, urgent)">
                <Input name="code" placeholder="Code" required disabled={pending} autoComplete="off" />
              </Field>
              <Field label="Label" required hint="Human-readable display name">
                <Input name="label" placeholder="Label" required disabled={pending} autoComplete="off" />
              </Field>
            </>
          ) : (
            <p className="text-sm text-slate-600">
              This changes the server-reported status for <strong>{dialog?.item.label}</strong>. The result will be refreshed from the server.
            </p>
          )}
        </form>
      </OverlayDialog>
    </div>
  );
}
