import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
import { OverlayDialog } from "../shell/components/OverlayDialog";
import {
  Alert,
  Button,
  Card,
  type Column,
  DataTable,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
  StatusPill,
} from "../shell/components/ui";

/**
 * Checkpoint 0E — Enterprise Shared Services panel.
 *
 * Five cross-cutting services, all reusable by any future business module and
 * none of them aware of Complaint/Survey/Procurement: Notification Engine,
 * Document/File Service, Scheduler, Integration Boundary, and Observability.
 * Tahap A keeps server behavior authoritative: every mutation is confirmed in
 * a dialog, and read permissions are separated from management permissions.
 */

type Message = { type: "error" | "success"; text: string };
type ResourceState<T> = {
  data: T;
  loading: boolean;
  error: string | null;
  status: number | null;
};

type Dialog =
  | { kind: "mark-read"; notification: Notification }
  | { kind: "upload" }
  | { kind: "delete-document"; document: DocumentRecord }
  | { kind: "trigger-job"; job: ScheduledJob }
  | { kind: "job-runs"; job: ScheduledJob }
  | { kind: "endpoint" }
  | { kind: "endpoint-status"; endpoint: IntegrationEndpoint }
  | null;

type EndpointForm = {
  code: string;
  name: string;
  direction: "outbound" | "inbound";
  baseUrl: string;
  webhookSecret: string;
};

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const emptyEndpointForm: EndpointForm = {
  code: "",
  name: "",
  direction: "outbound",
  baseUrl: "",
  webhookSecret: "",
};

function initialResource<T>(data: T, loading = true): ResourceState<T> {
  return { data, loading, error: null, status: null };
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError && error.status === 401) return "Your session has expired. Sign in again.";
  if (error instanceof ApiError && error.status === 403) return "You do not have permission to view this resource.";
  return error instanceof ApiError ? error.message : fallback;
}

function errorStatus(error: unknown) {
  return error instanceof ApiError ? error.status : null;
}

function bytesLabel(sizeBytes: number) {
  if (sizeBytes >= 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(sizeBytes / 1024).toFixed(1)} KB`;
}

function ResourceBlock<T>({
  resource,
  loadingLabel,
  children,
}: {
  resource: ResourceState<T>;
  loadingLabel: string;
  children: React.ReactNode;
}) {
  if (resource.loading) return <Spinner label={loadingLabel} />;
  if (resource.status === 401) return <EmptyState title="Your session has expired" description="Sign in again to continue." />;
  if (resource.status === 403) return <EmptyState title="Access denied" description="You do not have permission to view this resource." />;
  if (resource.error) return <Alert tone="error">{resource.error}</Alert>;
  return <>{children}</>;
}

export function SharedServicesPanel({
  token,
  canManageDocuments,
  canManageScheduler,
  canReadIntegration,
  canManageIntegration,
  canReadObservability,
  onMessage,
}: {
  token: string;
  canManageDocuments: boolean;
  canManageScheduler: boolean;
  canReadIntegration?: boolean;
  canManageIntegration?: boolean;
  canReadObservability: boolean;
  onMessage: (m: Message) => void;
}) {
  const integrationRead = canReadIntegration ?? canManageIntegration ?? false;
  const integrationManage = canManageIntegration ?? false;

  const [notifications, setNotifications] = useState<ResourceState<Notification[]>>(initialResource([]));
  const [instances, setInstances] = useState<ResourceState<WorkflowInstance[]>>(initialResource([]));
  const [documents, setDocuments] = useState<ResourceState<DocumentRecord[]>>(initialResource([], false));
  const [jobs, setJobs] = useState<ResourceState<ScheduledJob[]>>(initialResource([], canManageScheduler));
  const [jobRuns, setJobRuns] = useState<ResourceState<ScheduledJobRun[]>>(initialResource([], false));
  const [endpoints, setEndpoints] = useState<ResourceState<IntegrationEndpoint[]>>(initialResource([], integrationRead));
  const [integrationLog, setIntegrationLog] = useState<ResourceState<IntegrationLogEntry[]>>(initialResource([], integrationRead));
  const [events, setEvents] = useState<ResourceState<DomainEvent[]>>(initialResource([], canReadObservability));

  const [selectedInstanceId, setSelectedInstanceId] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const [endpointForm, setEndpointForm] = useState<EndpointForm>(emptyEndpointForm);

  const generations = useRef<Record<string, number>>({});
  const dialogGeneration = useRef(0);
  const pendingRef = useRef(false);
  const objectUrlRef = useRef<string | null>(null);
  const restoreFocusRef = useRef<HTMLButtonElement | null>(null);

  const loadResource = useCallback(
    <T,>(
      key: string,
      setter: React.Dispatch<React.SetStateAction<ResourceState<T>>>,
      request: () => Promise<T>,
      fallback: string,
    ) => {
      const generation = (generations.current[key] ?? 0) + 1;
      generations.current[key] = generation;
      setter((state) => ({ ...state, loading: true, error: null, status: null }));
      request()
        .then((data) => {
          if (generations.current[key] !== generation) return;
          setter({ data, loading: false, error: null, status: null });
        })
        .catch((error) => {
          if (generations.current[key] !== generation) return;
          setter((state) => ({
            ...state,
            loading: false,
            error: errorMessage(error, fallback),
            status: errorStatus(error),
          }));
        });
    },
    [],
  );

  const refresh = useCallback(() => {
    loadResource("notifications", setNotifications, () => api.myNotifications(token), "Failed to load notifications.");
    loadResource("instances", setInstances, () => api.workflowInstances(token), "Failed to load workflow instances.");

    if (canManageScheduler) {
      loadResource("jobs", setJobs, () => api.scheduledJobs(token), "Failed to load scheduler jobs.");
    } else {
      generations.current.jobs = (generations.current.jobs ?? 0) + 1;
      setJobs({ data: [], loading: false, error: null, status: null });
    }

    if (integrationRead) {
      loadResource("endpoints", setEndpoints, () => api.integrationEndpoints(token), "Failed to load integration endpoints.");
      loadResource("integrationLog", setIntegrationLog, () => api.integrationLog(token), "Failed to load integration log.");
    } else {
      generations.current.endpoints = (generations.current.endpoints ?? 0) + 1;
      generations.current.integrationLog = (generations.current.integrationLog ?? 0) + 1;
      setEndpoints({ data: [], loading: false, error: null, status: 403 });
      setIntegrationLog({ data: [], loading: false, error: null, status: 403 });
    }

    if (canReadObservability) {
      loadResource("events", setEvents, () => api.observabilityEvents(token), "Failed to load observability events.");
    } else {
      generations.current.events = (generations.current.events ?? 0) + 1;
      setEvents({ data: [], loading: false, error: null, status: 403 });
    }
  }, [canManageScheduler, canReadObservability, integrationRead, loadResource, token]);

  useEffect(() => {
    refresh();
    // Capture the counters object once. The object identity never changes, but
    // reading `generations.current` inside the cleanup would re-read it after
    // an unknown number of renders; pinning it to the effect's own scope is
    // what the rule asks for and keeps the "invalidate every in-flight
    // request" intent unambiguous.
    const generationCounters = generations.current;
    return () => {
      Object.keys(generationCounters).forEach((key) => {
        generationCounters[key] += 1;
      });
      dialogGeneration.current += 1;
      pendingRef.current = false;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [refresh]);

  useEffect(() => {
    if (!instances.data.some((instance) => instance.id === selectedInstanceId)) {
      setSelectedInstanceId(instances.data[0]?.id ?? "");
    }
  }, [instances.data, selectedInstanceId]);

  const selectedInstance = useMemo(
    () => instances.data.find((instance) => instance.id === selectedInstanceId) ?? null,
    [instances.data, selectedInstanceId],
  );

  const loadDocuments = useCallback(
    (instance: WorkflowInstance | null) => {
      if (!instance) {
        generations.current.documents = (generations.current.documents ?? 0) + 1;
        setDocuments({ data: [], loading: false, error: null, status: null });
        return;
      }
      loadResource(
        "documents",
        setDocuments,
        () => api.documentsForEntity(token, "demo_transaction", instance.entityId),
        "Failed to load documents.",
      );
    },
    [loadResource, token],
  );

  useEffect(() => {
    loadDocuments(selectedInstance);
  }, [loadDocuments, selectedInstance]);

  function openDialog(nextDialog: Dialog, trigger?: HTMLButtonElement) {
    if (pendingRef.current) return;
    dialogGeneration.current += 1;
    restoreFocusRef.current = trigger ?? null;
    setDialog(nextDialog);
    setDialogError(null);
    if (nextDialog?.kind === "upload") {
      setUploadFile(null);
      setUploadInputKey((key) => key + 1);
    }
    if (nextDialog?.kind === "endpoint") setEndpointForm(emptyEndpointForm);
  }

  function closeDialog() {
    if (pendingRef.current) return;
    dialogGeneration.current += 1;
    setDialog(null);
    setDialogError(null);
    setUploadFile(null);
    setEndpointForm(emptyEndpointForm);
  }

  async function runMutation(action: () => Promise<unknown>, success: string, afterSuccess?: () => void) {
    if (pendingRef.current) return;
    const generation = ++dialogGeneration.current;
    pendingRef.current = true;
    setPending(true);
    setDialogError(null);
    try {
      await action();
      if (dialogGeneration.current !== generation) return;
      onMessage({ type: "success", text: success });
      setDialog(null);
      setUploadFile(null);
      setEndpointForm(emptyEndpointForm);
      afterSuccess?.();
    } catch (error) {
      if (dialogGeneration.current !== generation) return;
      const text = errorMessage(error, "Operation failed.");
      setDialogError(text);
      onMessage({ type: "error", text });
    } finally {
      if (dialogGeneration.current === generation) {
        pendingRef.current = false;
        setPending(false);
      }
    }
  }

  async function downloadDocument(document: DocumentRecord) {
    try {
      const blob = await api.downloadDocument(token, document.id);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = document.fileName;
      anchor.rel = "noopener";
      anchor.click();
    } catch (error) {
      onMessage({ type: "error", text: errorMessage(error, "Download failed.") });
    }
  }

  function submitDialog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog || pendingRef.current) return;

    if (dialog.kind === "upload") {
      const file = uploadFile;
      const instance = selectedInstance;
      if (!instance) {
        setDialogError("Choose a Workflow Instance before uploading a document.");
        return;
      }
      if (!file) {
        setDialogError("Choose a file before uploading.");
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setDialogError("Files must be 20 MB or smaller.");
        return;
      }
      void runMutation(
        () => api.uploadDocument(token, "demo_transaction", instance.entityId, file),
        `Uploaded ${file.name}.`,
        () => loadDocuments(instance),
      );
      return;
    }

    if (dialog.kind === "delete-document") {
      const document = dialog.document;
      const instance = selectedInstance;
      void runMutation(
        () => api.deleteDocument(token, document.id),
        "Document deleted.",
        () => loadDocuments(instance),
      );
      return;
    }

    if (dialog.kind === "mark-read") {
      const notification = dialog.notification;
      void runMutation(
        () => api.markNotificationRead(token, notification.id),
        "Notification marked read.",
        refresh,
      );
      return;
    }

    if (dialog.kind === "trigger-job") {
      const job = dialog.job;
      void runMutation(
        () => api.triggerScheduledJob(token, job.jobCode),
        `Scheduler job '${job.jobCode}' triggered.`,
        refresh,
      );
      return;
    }

    if (dialog.kind === "endpoint-status") {
      const endpoint = dialog.endpoint;
      const next = !endpoint.isActive;
      void runMutation(
        () => api.setIntegrationEndpointActive(token, endpoint.code, next),
        `Endpoint ${next ? "activated" : "deactivated"}.`,
        refresh,
      );
      return;
    }

    if (dialog.kind === "endpoint") {
      const code = endpointForm.code.trim();
      const name = endpointForm.name.trim();
      const direction = endpointForm.direction;
      const baseUrl = endpointForm.baseUrl.trim() || null;
      const webhookSecret = endpointForm.webhookSecret || null;
      if (!code || !name) {
        setDialogError("Code and name are required.");
        return;
      }
      void runMutation(
        () => api.createIntegrationEndpoint(token, { code, name, direction, baseUrl, webhookSecret }),
        "Integration endpoint created.",
        refresh,
      );
    }
  }

  function openJobRuns(job: ScheduledJob, trigger?: HTMLButtonElement) {
    openDialog({ kind: "job-runs", job }, trigger);
    loadResource("jobRuns", setJobRuns, () => api.scheduledJobRuns(token, job.jobCode), "Failed to load run history.");
  }

  const notificationColumns: Column<Notification>[] = [
    { header: "Notification", mobileRole: "title", cell: (item) => item.subject ?? item.eventType },
    { header: "Body", mobileRole: "detail", cell: (item) => item.body },
    { header: "Channel", cell: (item) => item.channel },
    {
      header: "Status",
      mobileRole: "status",
      cell: (item) => <StatusPill tone={item.readAt ? "neutral" : "info"}>{item.readAt ? "Read" : "Unread"}</StatusPill>,
    },
    { header: "Created", cell: (item) => new Date(item.createdAt).toLocaleString() },
    {
      header: "Action",
      cell: (item) =>
        item.readAt ? (
          "—"
        ) : (
          <Button variant="ghost" className="min-h-0 px-2 py-1 text-xs" onClick={(event) => openDialog({ kind: "mark-read", notification: item }, event.currentTarget)}>
            Mark read
          </Button>
        ),
    },
  ];

  const documentColumns: Column<DocumentRecord>[] = [
    { header: "File", mobileRole: "title", cell: (item) => item.fileName },
    { header: "MIME", mobileRole: "detail", cell: (item) => item.mimeType },
    { header: "Size", cell: (item) => bytesLabel(item.sizeBytes) },
    { header: "Uploaded", cell: (item) => new Date(item.createdAt).toLocaleString() },
    {
      header: "Actions",
      cell: (item) => (
        <div className="flex flex-wrap gap-1">
          <Button variant="ghost" className="min-h-0 px-2 py-1 text-xs" onClick={() => void downloadDocument(item)}>
            Download
          </Button>
          {canManageDocuments && (
            <Button variant="ghost" className="min-h-0 px-2 py-1 text-xs" onClick={(event) => openDialog({ kind: "delete-document", document: item }, event.currentTarget)}>
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  const jobColumns: Column<ScheduledJob>[] = [
    {
      header: "Job",
      mobileRole: "title",
      cell: (item) => (
        <span>
          {item.name}
          <span className="block font-mono text-xs text-slate-500">{item.jobCode}</span>
        </span>
      ),
    },
    { header: "Interval", mobileRole: "detail", cell: (item) => `Every ${item.intervalSeconds}s` },
    {
      header: "Status",
      mobileRole: "status",
      cell: (item) => <StatusPill tone={item.lastStatus === "failed" ? "danger" : item.lastStatus === "success" ? "success" : "neutral"}>{item.lastStatus ?? "Never run"}</StatusPill>,
    },
    { header: "Last run", cell: (item) => (item.lastRunAt ? new Date(item.lastRunAt).toLocaleString() : "—") },
    {
      header: "Actions",
      cell: (item) => (
        <div className="flex flex-wrap gap-1">
          <Button variant="secondary" className="min-h-0 px-2 py-1 text-xs" onClick={(event) => openDialog({ kind: "trigger-job", job: item }, event.currentTarget)}>
            Trigger now
          </Button>
          <Button variant="ghost" className="min-h-0 px-2 py-1 text-xs" onClick={(event) => openJobRuns(item, event.currentTarget)}>
            History
          </Button>
        </div>
      ),
    },
  ];

  const endpointColumns: Column<IntegrationEndpoint>[] = [
    {
      header: "Endpoint",
      mobileRole: "title",
      cell: (item) => (
        <span>
          {item.name}
          <span className="block font-mono text-xs text-slate-500">{item.code}</span>
        </span>
      ),
    },
    { header: "Direction", mobileRole: "detail", cell: (item) => item.direction },
    { header: "Base URL", cell: (item) => item.baseUrl ?? "—" },
    {
      header: "Status",
      mobileRole: "status",
      cell: (item) => <StatusPill tone={item.isActive ? "success" : "neutral"}>{item.isActive ? "Active" : "Inactive"}</StatusPill>,
    },
    {
      header: "Action",
      cell: (item) =>
        integrationManage ? (
          <Button variant="ghost" className="min-h-0 px-2 py-1 text-xs" onClick={(event) => openDialog({ kind: "endpoint-status", endpoint: item }, event.currentTarget)}>
            {item.isActive ? "Deactivate" : "Activate"}
          </Button>
        ) : (
          "—"
        ),
    },
  ];

  const logColumns: Column<IntegrationLogEntry>[] = [
    { header: "Event", mobileRole: "title", cell: (item) => item.eventType },
    { header: "Direction", mobileRole: "detail", cell: (item) => item.direction },
    { header: "Status", mobileRole: "status", cell: (item) => item.status },
    { header: "Created", cell: (item) => new Date(item.createdAt).toLocaleString() },
  ];

  const eventColumns: Column<DomainEvent>[] = [
    { header: "Event", mobileRole: "title", cell: (item) => item.eventType },
    { header: "Entity", mobileRole: "detail", cell: (item) => item.entityType },
    { header: "Entity ID", cell: (item) => (item.entityId ? `${item.entityId.slice(0, 8)}…` : "—") },
    { header: "Occurred", cell: (item) => new Date(item.occurredAt).toLocaleString() },
  ];

  const runColumns: Column<ScheduledJobRun>[] = [
    { header: "Started", mobileRole: "title", cell: (item) => new Date(item.startedAt).toLocaleString() },
    { header: "Trigger", mobileRole: "detail", cell: (item) => item.trigger },
    { header: "Status", mobileRole: "status", cell: (item) => <StatusPill tone={item.status === "failed" ? "danger" : item.status === "success" ? "success" : "info"}>{item.status}</StatusPill> },
    { header: "Finished", cell: (item) => (item.finishedAt ? new Date(item.finishedAt).toLocaleString() : "—") },
    { header: "Error", cell: (item) => item.errorMessage ?? "—" },
  ];

  const dialogTitle = dialog?.kind === "mark-read"
    ? "Mark notification read"
    : dialog?.kind === "upload"
      ? "Upload document"
      : dialog?.kind === "delete-document"
        ? "Delete document"
        : dialog?.kind === "trigger-job"
          ? "Trigger scheduler job"
          : dialog?.kind === "endpoint"
            ? "Create integration endpoint"
            : dialog?.kind === "endpoint-status"
              ? `${dialog.endpoint.isActive ? "Deactivate" : "Activate"} endpoint`
              : dialog?.kind === "job-runs"
                ? "Scheduler run history"
                : "Shared Services";

  const dialogDescription = dialog?.kind === "endpoint"
    ? "Secrets can be entered here but are never displayed after submission."
    : dialog?.kind === "upload"
      ? "Attach a file to the selected Workflow Instance. Maximum size is 20 MB."
      : dialog?.kind === "job-runs"
        ? `Recent runs for ${dialog.job.jobCode}.`
        : "The server will re-check permissions when you confirm.";

  const confirmLabel = dialog?.kind === "endpoint"
    ? "Create endpoint"
    : dialog?.kind === "upload"
      ? "Upload"
      : dialog?.kind === "endpoint-status"
        ? dialog.endpoint.isActive ? "Deactivate" : "Activate"
        : dialog?.kind === "trigger-job"
          ? "Trigger now"
          : "Confirm";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Enterprise Shared Services</h2>
        <p className="text-sm text-slate-500">Documents, notifications, scheduler, integrations, and observability.</p>
      </div>

      <Card>
        <div className="mb-3">
          <h3 className="text-base font-semibold">My Notifications</h3>
          <p className="text-xs text-slate-500">In-app notifications delivered to the signed-in user.</p>
        </div>
        <ResourceBlock resource={notifications} loadingLabel="Loading notifications…">
          <DataTable
            columns={notificationColumns}
            rows={notifications.data}
            keyOf={(item) => item.id}
            mobileBreakpoint="md"
            empty={<EmptyState title="No notifications" description="No notifications have been delivered to you." />}
          />
        </ResourceBlock>
      </Card>

      <Card>
        <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-base font-semibold">Document / File Service</h3>
            <p className="text-xs text-slate-500">Files are attached to a selected Workflow Instance. Maximum upload size is 20 MB.</p>
          </div>
          {canManageDocuments && (
            <Button disabled={!selectedInstance} onClick={(event) => openDialog({ kind: "upload" }, event.currentTarget)}>
              Upload document
            </Button>
          )}
        </div>
        <Field label="Workflow Instance" required>
          <Select
            value={selectedInstanceId}
            onChange={(event) => setSelectedInstanceId(event.target.value)}
            disabled={instances.loading || instances.data.length === 0}
          >
            <option value="">{instances.data.length === 0 ? "No Workflow Instances loaded" : "Select an instance"}</option>
            {instances.data.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.id.slice(0, 8)}… ({instance.status})
              </option>
            ))}
          </Select>
        </Field>
        {instances.error && <div className="mt-3"><Alert tone="error">{instances.error}</Alert></div>}
        <div className="mt-3">
          <ResourceBlock resource={documents} loadingLabel="Loading documents…">
            <DataTable
              columns={documentColumns}
              rows={documents.data.filter((item) => item.deletedAt === null)}
              keyOf={(item) => item.id}
              mobileBreakpoint="md"
              empty={<EmptyState title="No documents" description="No documents are attached to this instance." />}
            />
          </ResourceBlock>
        </div>
      </Card>

      {canManageScheduler && (
        <Card>
          <div className="mb-3">
            <h3 className="text-base font-semibold">Scheduler / Background Jobs</h3>
            <p className="text-xs text-slate-500">Automatic jobs are read-only here; manual trigger and history use existing routes.</p>
          </div>
          <ResourceBlock resource={jobs} loadingLabel="Loading scheduler jobs…">
            <DataTable
              columns={jobColumns}
              rows={jobs.data}
              keyOf={(item) => item.id}
              mobileBreakpoint="md"
              empty={<EmptyState title="No jobs" description="No scheduler jobs are configured." />}
            />
          </ResourceBlock>
        </Card>
      )}

      {integrationRead && (
        <Card>
          <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h3 className="text-base font-semibold">Integration Boundary</h3>
              <p className="text-xs text-slate-500">Read access is separate from endpoint management. Secrets are never shown in lists, logs, or summaries.</p>
            </div>
            {integrationManage && (
              <Button onClick={(event) => openDialog({ kind: "endpoint" }, event.currentTarget)}>Create endpoint</Button>
            )}
          </div>
          <ResourceBlock resource={endpoints} loadingLabel="Loading integration endpoints…">
            <DataTable
              columns={endpointColumns}
              rows={endpoints.data}
              keyOf={(item) => item.id}
              mobileBreakpoint="md"
              empty={<EmptyState title="No endpoints" description="No integration endpoints are configured." />}
            />
          </ResourceBlock>
          <div className="mt-6">
            <h4 className="mb-3 text-sm font-semibold text-slate-700">Recent integration log</h4>
            <ResourceBlock resource={integrationLog} loadingLabel="Loading integration log…">
              <DataTable
                columns={logColumns}
                rows={integrationLog.data.slice(0, 20)}
                keyOf={(item) => item.id}
                mobileBreakpoint="md"
                empty={<EmptyState title="No log entries" description="No integration activity is available." />}
              />
            </ResourceBlock>
          </div>
        </Card>
      )}

      {canReadObservability && (
        <Card>
          <div className="mb-3">
            <h3 className="text-base font-semibold">Observability — Domain Event Log</h3>
            <p className="text-xs text-slate-500">Raw domain events consumed by notifications and integrations.</p>
          </div>
          <ResourceBlock resource={events} loadingLabel="Loading domain events…">
            <DataTable
              columns={eventColumns}
              rows={events.data.slice(0, 30)}
              keyOf={(item) => item.id}
              mobileBreakpoint="md"
              empty={<EmptyState title="No events" description="No domain events are available." />}
            />
          </ResourceBlock>
        </Card>
      )}

      <OverlayDialog
        open={dialog !== null}
        title={dialogTitle}
        description={dialogDescription}
        pending={pending}
        onClose={closeDialog}
        restoreFocusRef={restoreFocusRef}
        size={dialog?.kind === "job-runs" ? "lg" : "md"}
        footer={
          dialog?.kind === "job-runs" ? (
            <Button variant="secondary" onClick={closeDialog}>Close</Button>
          ) : (
            <>
              <Button variant="secondary" disabled={pending} onClick={closeDialog}>
                Cancel
              </Button>
              <Button type="submit" form="shared-services-dialog-form" disabled={pending}>
                {pending ? "Saving…" : confirmLabel}
              </Button>
            </>
          )
        }
      >
        {dialog?.kind === "job-runs" ? (
          <ResourceBlock resource={jobRuns} loadingLabel="Loading run history…">
            <DataTable
              columns={runColumns}
              rows={jobRuns.data}
              keyOf={(item) => item.id}
              mobileBreakpoint="md"
              empty={<EmptyState title="No runs" description="This job has no visible run history." />}
            />
          </ResourceBlock>
        ) : (
          <form id="shared-services-dialog-form" className="space-y-4" onSubmit={submitDialog}>
            {dialogError && <Alert tone="error">{dialogError}</Alert>}

            {dialog?.kind === "mark-read" && (
              <p className="text-sm text-slate-600">
                Mark <strong>{dialog.notification.subject ?? dialog.notification.eventType}</strong> as read?
              </p>
            )}

            {dialog?.kind === "upload" && (
              <>
                <p className="text-sm text-slate-600">
                  Target instance: <strong>{selectedInstance ? `${selectedInstance.id.slice(0, 8)}… (${selectedInstance.status})` : "No instance selected"}</strong>
                </p>
                <Field label="File" required hint="Maximum 20 MB.">
                  <Input
                    key={uploadInputKey}
                    type="file"
                    disabled={pending}
                    onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                  />
                </Field>
              </>
            )}

            {dialog?.kind === "delete-document" && (
              <p className="text-sm text-slate-600">
                Delete <strong>{dialog.document.fileName}</strong>? The server will enforce authorization before removing it.
              </p>
            )}

            {dialog?.kind === "trigger-job" && (
              <p className="text-sm text-slate-600">
                Trigger <strong>{dialog.job.jobCode}</strong> now? This uses the existing scheduler route.
              </p>
            )}

            {dialog?.kind === "endpoint-status" && (
              <p className="text-sm text-slate-600">
                {dialog.endpoint.isActive ? "Deactivate" : "Activate"} <strong>{dialog.endpoint.name}</strong>? Logs and endpoint summaries never display webhook secrets.
              </p>
            )}

            {dialog?.kind === "endpoint" && (
              <>
                <Field label="Code" required>
                  <Input
                    value={endpointForm.code}
                    onChange={(event) => setEndpointForm((form) => ({ ...form, code: event.target.value }))}
                    disabled={pending}
                    autoComplete="off"
                  />
                </Field>
                <Field label="Name" required>
                  <Input
                    value={endpointForm.name}
                    onChange={(event) => setEndpointForm((form) => ({ ...form, name: event.target.value }))}
                    disabled={pending}
                    autoComplete="off"
                  />
                </Field>
                <Field label="Direction" required>
                  <Select
                    value={endpointForm.direction}
                    onChange={(event) => setEndpointForm((form) => ({ ...form, direction: event.target.value as "outbound" | "inbound" }))}
                    disabled={pending}
                  >
                    <option value="outbound">Outbound</option>
                    <option value="inbound">Inbound</option>
                  </Select>
                </Field>
                <Field label="Base URL" hint="Leave blank when not applicable.">
                  <Input
                    value={endpointForm.baseUrl}
                    onChange={(event) => setEndpointForm((form) => ({ ...form, baseUrl: event.target.value }))}
                    disabled={pending}
                    autoComplete="url"
                  />
                </Field>
                <Field label="Webhook secret" hint="Stored by the server when provided; never displayed after submission.">
                  <Input
                    type="password"
                    value={endpointForm.webhookSecret}
                    onChange={(event) => setEndpointForm((form) => ({ ...form, webhookSecret: event.target.value }))}
                    disabled={pending}
                    autoComplete="new-password"
                  />
                </Field>
              </>
            )}
          </form>
        )}
      </OverlayDialog>
    </div>
  );
}
