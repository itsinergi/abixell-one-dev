import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  type DocumentRecord,
  type DomainEvent,
  type IntegrationEndpoint,
  type IntegrationLogEntry,
  type Notification,
  type ScheduledJob,
  type ScheduledJobRun,
  type WorkflowInstance,
} from "../lib/api";

/**
 * Checkpoint 0E — Enterprise Shared Services panel.
 *
 * Five cross-cutting services, all reusable by any future business
 * module and none of them aware of Complaint/Survey/Procurement:
 * Notification Engine (in-app inbox), Document/File Service (attach a
 * file to any Workflow Instance from 0D), Scheduler (the Workflow
 * Escalation Sweep now runs automatically — this shows its run
 * history), Integration Boundary (outbound stub log + inbound webhook
 * endpoints), and Observability (the raw Domain Event log everything
 * above is built on).
 */
export function SharedServicesPanel({
  token,
  canManageDocuments,
  canManageScheduler,
  canManageIntegration,
  canReadObservability,
  onMessage,
}: {
  token: string;
  canManageDocuments: boolean;
  canManageScheduler: boolean;
  canManageIntegration: boolean;
  canReadObservability: boolean;
  onMessage: (m: { type: "error" | "success"; text: string }) => void;
}) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState("");
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [jobRuns, setJobRuns] = useState<ScheduledJobRun[]>([]);
  const [endpoints, setEndpoints] = useState<IntegrationEndpoint[]>([]);
  const [integrationLog, setIntegrationLog] = useState<IntegrationLogEntry[]>([]);
  const [events, setEvents] = useState<DomainEvent[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const tasks: Array<Promise<void>> = [
        api.myNotifications(token).then(setNotifications).catch(() => undefined),
        api.workflowInstances(token).then(setInstances).catch(() => undefined),
      ];
      if (canManageScheduler) {
        tasks.push(api.scheduledJobs(token).then(setJobs).catch(() => undefined));
      }
      if (canManageIntegration) {
        tasks.push(api.integrationEndpoints(token).then(setEndpoints).catch(() => undefined));
        tasks.push(api.integrationLog(token).then(setIntegrationLog).catch(() => undefined));
      }
      if (canReadObservability) {
        tasks.push(api.observabilityEvents(token).then(setEvents).catch(() => undefined));
      }
      await Promise.all(tasks);
    } catch (err) {
      onMessage({ type: "error", text: err instanceof ApiError ? err.message : "Failed to load Shared Services data" });
    }
  }, [token, canManageScheduler, canManageIntegration, canReadObservability, onMessage]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (instances.length > 0 && !selectedInstanceId) setSelectedInstanceId(instances[0].id);
  }, [instances, selectedInstanceId]);

  useEffect(() => {
    if (!selectedInstanceId) {
      setDocuments([]);
      return;
    }
    api
      .documentsForEntity(token, "demo_transaction", instances.find((i) => i.id === selectedInstanceId)?.entityId ?? "")
      .then(setDocuments)
      .catch(() => setDocuments([]));
  }, [token, selectedInstanceId, instances]);

  async function handleMarkRead(id: string) {
    try {
      await api.markNotificationRead(token, id);
      refresh();
    } catch (err) {
      onMessage({ type: "error", text: err instanceof ApiError ? err.message : "Failed" });
    }
  }

  async function handleUploadDocument() {
    const file = fileInputRef.current?.files?.[0];
    const instance = instances.find((i) => i.id === selectedInstanceId);
    if (!file || !instance) {
      onMessage({ type: "error", text: "Pick a Workflow Instance and a file first." });
      return;
    }
    try {
      await api.uploadDocument(token, "demo_transaction", instance.entityId, file);
      onMessage({ type: "success", text: `Uploaded '${file.name}' — attached to instance ${instance.id.slice(0, 8)}…` });
      if (fileInputRef.current) fileInputRef.current.value = "";
      const list = await api.documentsForEntity(token, "demo_transaction", instance.entityId);
      setDocuments(list);
      refresh();
    } catch (err) {
      onMessage({ type: "error", text: err instanceof ApiError ? err.message : "Upload failed" });
    }
  }

  async function handleDeleteDocument(id: string) {
    try {
      await api.deleteDocument(token, id);
      const instance = instances.find((i) => i.id === selectedInstanceId);
      if (instance) setDocuments(await api.documentsForEntity(token, "demo_transaction", instance.entityId));
    } catch (err) {
      onMessage({ type: "error", text: err instanceof ApiError ? err.message : "Failed" });
    }
  }

  async function handleTriggerJob(jobCode: string) {
    try {
      const run = await api.triggerScheduledJob(token, jobCode);
      onMessage({ type: "success", text: `Job '${jobCode}' ran — status: ${run.status}.` });
      const runs = await api.scheduledJobRuns(token, jobCode);
      setJobRuns(runs);
      refresh();
    } catch (err) {
      onMessage({ type: "error", text: err instanceof ApiError ? err.message : "Failed" });
    }
  }

  async function handleViewRuns(jobCode: string) {
    try {
      setJobRuns(await api.scheduledJobRuns(token, jobCode));
    } catch {
      setJobRuns([]);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-sm font-semibold text-slate-500">Enterprise Shared Services (Checkpoint 0E)</h2>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Notifications */}
        <section className="rounded border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold">My Notifications</h3>
          <p className="mb-2 text-xs text-slate-500">
            Rendered from Tenant-Configuration Templates whenever a Domain Event (e.g. a Workflow task
            assignment) names you — directly or via a Role+Scope queue — as the recipient.
          </p>
          <ul className="space-y-2 text-sm text-slate-700">
            {notifications.length === 0 && <li className="text-xs text-slate-400">No notifications yet.</li>}
            {notifications.map((n) => (
              <li key={n.id} className="border-b border-slate-100 pb-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{n.subject ?? n.eventType}</span>
                  {!n.readAt && (
                    <button onClick={() => handleMarkRead(n.id)} className="text-xs text-slate-500 underline">
                      Mark read
                    </button>
                  )}
                </div>
                <div className="text-xs text-slate-500">{n.body}</div>
                <div className="text-[10px] text-slate-400">
                  {n.channel} · {n.status} · {new Date(n.createdAt).toLocaleString()}
                  {n.readAt && " · read"}
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Documents */}
        <section className="rounded border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold">Document / File Service</h3>
          <p className="mb-2 text-xs text-slate-500">
            Attach a file to any Workflow Instance (polymorphic reference — same pattern as Workflow's
            entityId).
          </p>
          <select
            value={selectedInstanceId}
            onChange={(e) => setSelectedInstanceId(e.target.value)}
            className="mb-2 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          >
            {instances.length === 0 && <option value="">No Workflow Instances yet</option>}
            {instances.map((i) => (
              <option key={i.id} value={i.id}>
                {i.id.slice(0, 8)}… ({i.status})
              </option>
            ))}
          </select>
          {canManageDocuments && (
            <div className="mb-2 flex gap-2">
              <input ref={fileInputRef} type="file" className="flex-1 text-xs" />
              <button onClick={handleUploadDocument} className="rounded bg-slate-900 px-3 py-1 text-xs text-white">
                Upload
              </button>
            </div>
          )}
          <ul className="space-y-1 text-xs text-slate-600">
            {documents.length === 0 && <li className="text-slate-400">No documents for this instance.</li>}
            {documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between border-t border-slate-100 pt-1">
                <a href={`${api.documentDownloadUrl(d.id)}`} className="underline">
                  {d.fileName}
                </a>
                <span className="flex items-center gap-2">
                  <span>{(d.sizeBytes / 1024).toFixed(1)} KB</span>
                  {canManageDocuments && (
                    <button onClick={() => handleDeleteDocument(d.id)} className="text-red-600 underline">
                      Delete
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Scheduler */}
        {canManageScheduler && (
          <section className="rounded border border-slate-200 bg-white p-4">
            <h3 className="mb-2 text-sm font-semibold">Scheduler / Background Jobs</h3>
            <p className="mb-2 text-xs text-slate-500">
              The Workflow Escalation Sweep runs automatically on this interval — this is its run history,
              proving "scheduler"-triggered runs (not just manual clicks) actually happen.
            </p>
            <ul className="space-y-2 text-xs text-slate-700">
              {jobs.map((j) => (
                <li key={j.id} className="border-b border-slate-100 pb-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{j.name}</span>
                    <span className="text-slate-400">every {j.intervalSeconds}s</span>
                  </div>
                  <div className="text-slate-500">
                    last run: {j.lastRunAt ? new Date(j.lastRunAt).toLocaleString() : "never"}
                    {j.lastStatus && ` (${j.lastStatus})`}
                  </div>
                  <div className="mt-1 flex gap-2">
                    <button onClick={() => handleTriggerJob(j.jobCode)} className="rounded bg-slate-900 px-2 py-0.5 text-white">
                      Trigger now
                    </button>
                    <button onClick={() => handleViewRuns(j.jobCode)} className="rounded bg-slate-100 px-2 py-0.5">
                      View run history
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {jobRuns.length > 0 && (
              <ul className="mt-2 space-y-1 text-[10px] text-slate-500">
                {jobRuns.map((r) => (
                  <li key={r.id}>
                    {new Date(r.startedAt).toLocaleString()} — {r.trigger} — {r.status}
                    {r.resultSummary && ` — ${JSON.stringify(r.resultSummary)}`}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Integration Boundary */}
        {canManageIntegration && (
          <section className="rounded border border-slate-200 bg-white p-4">
            <h3 className="mb-2 text-sm font-semibold">Integration Boundary</h3>
            <p className="mb-2 text-xs text-slate-500">
              Outbound Endpoints get a logged dispatch stub for every Domain Event; inbound Endpoints accept
              a signed webhook and publish a Domain Event — never a direct database write.
            </p>
            <div className="mb-2 text-xs">
              <span className="font-medium">Endpoints:</span>{" "}
              {endpoints.length === 0 ? (
                <span className="text-slate-400">none configured</span>
              ) : (
                endpoints.map((e) => (
                  <span key={e.id} className="mr-2 inline-block rounded bg-slate-100 px-2 py-0.5">
                    {e.code} ({e.direction}, {e.isActive ? "active" : "inactive"})
                  </span>
                ))
              )}
            </div>
            <ul className="space-y-1 text-[10px] text-slate-500">
              {integrationLog.slice(0, 10).map((entry) => (
                <li key={entry.id}>
                  {new Date(entry.createdAt).toLocaleString()} — {entry.direction} — {entry.eventType} — {entry.status}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Observability */}
        {canReadObservability && (
          <section className="rounded border border-slate-200 bg-white p-4 lg:col-span-2">
            <h3 className="mb-2 text-sm font-semibold">Observability — Domain Event Log</h3>
            <p className="mb-2 text-xs text-slate-500">
              The durable Event Foundation log everything above (Notification, Integration outbound stub)
              subscribes to.
            </p>
            <ul className="space-y-1 text-[10px] text-slate-500">
              {events.slice(0, 15).map((e) => (
                <li key={e.id}>
                  {new Date(e.occurredAt).toLocaleString()} — <span className="font-mono">{e.eventType}</span> on{" "}
                  {e.entityType}
                  {e.entityId && ` (${e.entityId.slice(0, 8)}…)`}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
