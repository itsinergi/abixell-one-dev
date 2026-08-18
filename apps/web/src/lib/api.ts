const API_BASE = "/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, data.error ?? `Request failed (${response.status})`);
  }
  return data as T;
}

/** Multipart variant for the Document/File Service upload endpoint —
 * deliberately does NOT set Content-Type so the browser fills in the
 * multipart boundary itself. */
async function requestForm<T>(path: string, token: string, form: FormData): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, data.error ?? `Request failed (${response.status})`);
  }
  return data as T;
}

export const api = {
  login: (payload: { tenantCode: string; email: string; password: string }) =>
    request<{
      accessToken: string;
      refreshToken: string;
      userId: string;
      tenantId: string;
    }>("/auth/login", { method: "POST", body: payload }),

  me: (token: string) =>
    request<{ userId: string; tenantId: string; permissions: string[] }>("/me", { token }),

  // Frontend token/session persistence (Checkpoint 0F): `refresh` trades
  // the opaque refresh token for a new access token AND a rotated
  // refresh token (never reused — see refresh-token.ts); `logout`
  // revokes the refresh token server-side so a persisted-but-stale
  // token in localStorage can't be replayed after the user signs out.
  refresh: (refreshToken: string) =>
    request<{ accessToken: string; refreshToken: string }>("/auth/refresh", {
      method: "POST",
      body: { refreshToken },
    }),

  logout: (refreshToken: string) =>
    request<void>("/auth/logout", { method: "POST", body: { refreshToken } }),

  tenant: (token: string) =>
    request<{ id: string; code: string; name: string; status: string }>("/tenants/me", {
      token,
    }),

  organizationUnits: (token: string) =>
    request<
      Array<{
        id: string;
        parentId: string | null;
        name: string;
        unitType: string;
        legalEntityId: string;
      }>
    >("/organization-units", { token }),

  createOrganizationUnit: (
    token: string,
    payload: { legalEntityId: string; parentId?: string | null; name: string; unitType?: string },
  ) => request("/organization-units", { method: "POST", token, body: payload }),

  legalEntities: (token: string) =>
    request<Array<{ id: string; name: string }>>("/legal-entities", { token }),

  createLegalEntity: (token: string, payload: { name: string }) =>
    request("/legal-entities", { method: "POST", token, body: payload }),

  users: (token: string) =>
    request<Array<{ id: string; email: string; fullName: string; status: string }>>("/users", {
      token,
    }),

  createUser: (
    token: string,
    payload: {
      email: string;
      fullName: string;
      password: string;
      roleCode: string;
      scopeType: "tenant" | "organization_unit";
      scopeOrganizationUnitId?: string | null;
    },
  ) => request("/users", { method: "POST", token, body: payload }),

  // --- Checkpoint 0C: Configuration & Metadata Engine -----------------------
  configModules: (token: string) =>
    request<
      Array<{
        moduleId: string;
        moduleCode: string;
        moduleName: string;
        isActive: boolean;
        updatedAt: string | null;
      }>
    >("/config/modules", { token }),

  setConfigModuleActivation: (token: string, code: string, isActive: boolean) =>
    request(`/config/modules/${code}`, { method: "PUT", token, body: { isActive } }),

  configFeatureFlags: (token: string) =>
    request<
      Array<{ code: string; name: string; isEnabled: boolean; source: string }>
    >("/config/feature-flags", { token }),

  configEffectiveFeatureFlags: (token: string, organizationUnitId: string) =>
    request<
      Array<{ code: string; name: string; isEnabled: boolean; source: string }>
    >(`/config/feature-flags/effective?organizationUnitId=${organizationUnitId}`, { token }),

  setConfigFeatureFlag: (
    token: string,
    code: string,
    payload: {
      isEnabled: boolean;
      scopeType: "tenant" | "organization_unit";
      scopeOrganizationUnitId?: string;
    },
  ) => request(`/config/feature-flags/${code}`, { method: "PUT", token, body: payload }),

  configTerminology: (token: string) =>
    request<
      Array<{ code: string; defaultLabel: string; value: string; isOverridden: boolean }>
    >("/config/terminology", { token }),

  setConfigTerminology: (token: string, code: string, value: string) =>
    request(`/config/terminology/${code}`, { method: "PUT", token, body: { value } }),

  configReferenceDataTypes: (token: string) =>
    request<Array<{ code: string; name: string }>>("/config/reference-data-types", { token }),

  configReferenceDataItems: (token: string, typeCode: string) =>
    request<
      Array<{ id: string; code: string; label: string; sortOrder: number; isActive: boolean }>
    >(`/config/reference-data/${typeCode}`, { token }),

  createConfigReferenceDataItem: (
    token: string,
    typeCode: string,
    payload: { code: string; label: string; sortOrder?: number },
  ) => request(`/config/reference-data/${typeCode}`, { method: "POST", token, body: payload }),

  configNumberingSequence: (token: string, code: string) =>
    request<{ code: string; pattern: string; currentSequence: number }>(
      `/config/numbering/${code}`,
      { token },
    ),

  generateConfigNumber: (token: string, code: string) =>
    request<{ number: string; sequence: number }>(`/config/numbering/${code}/generate`, {
      method: "POST",
      token,
    }),

  recentAuditLog: (token: string) =>
    request<
      Array<{
        id: string;
        action: string;
        entityType: string;
        entityId: string | null;
        createdAt: string;
        metadata: Record<string, unknown>;
      }>
    >("/audit-log/recent", { token }),

  // --- Checkpoint 0D: Workflow & Approval Engine -----------------------------
  workflowDefinitions: (token: string) =>
    request<
      Array<{ id: string; code: string; name: string; entityType: string; description: string; isActive: boolean }>
    >("/workflow/definitions", { token }),

  createDemoTransaction: (token: string, title: string) =>
    request<{ id: string; title: string }>("/workflow/demo-transactions", {
      method: "POST",
      token,
      body: { title },
    }),

  startWorkflowInstance: (
    token: string,
    payload: { definitionCode: string; entityId: string; contextData?: Record<string, unknown> },
  ) =>
    request<{ instance: WorkflowInstance; assignment: WorkflowAssignment }>("/workflow/instances", {
      method: "POST",
      token,
      body: payload,
    }),

  workflowInstances: (token: string) => request<WorkflowInstance[]>("/workflow/instances", { token }),

  workflowInstanceHistory: (token: string, instanceId: string) =>
    request<
      Array<{
        id: string;
        fromStepId: string | null;
        toStepId: string | null;
        actionCode: string;
        actorUserId: string | null;
        comment: string | null;
        occurredAt: string;
      }>
    >(`/workflow/instances/${instanceId}/history`, { token }),

  myWorkflowAssignments: (token: string) =>
    request<WorkflowAssignment[]>("/workflow/my-assignments", { token }),

  actOnWorkflowAssignment: (
    token: string,
    assignmentId: string,
    payload: { actionCode: string; comment?: string | null },
  ) =>
    request<{ instance: WorkflowInstance; decidedAssignmentId: string; newAssignment: WorkflowAssignment | null }>(
      `/workflow/assignments/${assignmentId}/act`,
      { method: "POST", token, body: payload },
    ),

  triggerWorkflowEscalationSweep: (token: string) =>
    request<{ escalatedCount: number; escalated: WorkflowAssignment[] }>("/workflow/escalation-sweep", {
      method: "POST",
      token,
    }),

  claimWorkflowAssignment: (token: string, assignmentId: string) =>
    request<WorkflowAssignment>(`/workflow/assignments/${assignmentId}/claim`, { method: "POST", token }),

  releaseWorkflowAssignmentClaim: (token: string, assignmentId: string) =>
    request<WorkflowAssignment>(`/workflow/assignments/${assignmentId}/release-claim`, { method: "POST", token }),

  // --- Checkpoint 0E: Enterprise Shared Services -----------------------------
  notificationTemplates: (token: string) => request<NotificationTemplate[]>("/notifications/templates", { token }),

  createNotificationTemplate: (
    token: string,
    payload: { eventType: string; channel: string; subjectTemplate?: string | null; bodyTemplate: string },
  ) => request<NotificationTemplate>("/notifications/templates", { method: "POST", token, body: payload }),

  myNotifications: (token: string) => request<Notification[]>("/notifications/my", { token }),

  markNotificationRead: (token: string, id: string) =>
    request<Notification>(`/notifications/${id}/read`, { method: "POST", token }),

  documentsForEntity: (token: string, entityType: string, entityId: string) =>
    request<DocumentRecord[]>(`/documents?entityType=${entityType}&entityId=${entityId}`, { token }),

  uploadDocument: (token: string, entityType: string, entityId: string, file: File) => {
    const form = new FormData();
    form.append("entityType", entityType);
    form.append("entityId", entityId);
    form.append("file", file);
    return requestForm<DocumentRecord>("/documents", token, form);
  },

  documentDownloadUrl: (id: string) => `${API_BASE}/documents/${id}/download`,

  deleteDocument: (token: string, id: string) => request<DocumentRecord>(`/documents/${id}`, { method: "DELETE", token }),

  scheduledJobs: (token: string) => request<ScheduledJob[]>("/scheduler/jobs", { token }),

  scheduledJobRuns: (token: string, jobCode: string) =>
    request<ScheduledJobRun[]>(`/scheduler/jobs/${jobCode}/runs`, { token }),

  triggerScheduledJob: (token: string, jobCode: string) =>
    request<ScheduledJobRun>(`/scheduler/jobs/${jobCode}/trigger`, { method: "POST", token }),

  setScheduledJobEnabled: (token: string, jobCode: string, isEnabled: boolean) =>
    request<ScheduledJob>(`/scheduler/jobs/${jobCode}/enabled`, { method: "POST", token, body: { isEnabled } }),

  integrationEndpoints: (token: string) => request<IntegrationEndpoint[]>("/integration/endpoints", { token }),

  createIntegrationEndpoint: (
    token: string,
    payload: { code: string; name: string; direction: "outbound" | "inbound"; baseUrl?: string | null; webhookSecret?: string | null },
  ) => request<IntegrationEndpoint>("/integration/endpoints", { method: "POST", token, body: payload }),

  setIntegrationEndpointActive: (token: string, code: string, isActive: boolean) =>
    request<IntegrationEndpoint>(`/integration/endpoints/${code}/active`, { method: "POST", token, body: { isActive } }),

  integrationLog: (token: string) => request<IntegrationLogEntry[]>("/integration/log", { token }),

  observabilityEvents: (token: string) => request<DomainEvent[]>("/observability/events", { token }),
};

export type WorkflowInstance = {
  id: string;
  workflowDefinitionId: string;
  workflowVersionId: string;
  entityType: string;
  entityId: string;
  currentStepId: string | null;
  status: "in_progress" | "approved" | "rejected" | "cancelled";
  contextData: Record<string, unknown>;
  startedBy: string;
  startedAt: string;
  completedAt: string | null;
};

export type WorkflowAssignment = {
  id: string;
  workflowInstanceId: string;
  stepId: string;
  assignmentType: "role" | "specific_user";
  assignedRoleCode: string | null;
  assignedOrganizationUnitId: string | null;
  assignedUserId: string | null;
  assignedAt: string;
  dueAt: string | null;
  status: "pending" | "approved" | "rejected" | "returned" | "escalated" | "superseded";
  decidedBy: string | null;
  decidedAt: string | null;
  decisionActionCode: string | null;
  comment: string | null;
  claimedByUserId: string | null;
  claimedAt: string | null;
};

// --- Checkpoint 0E types ----------------------------------------------------

export type NotificationTemplate = {
  id: string;
  eventType: string;
  channel: "email" | "push" | "whatsapp" | "sms" | "in_app";
  subjectTemplate: string | null;
  bodyTemplate: string;
  isActive: boolean;
};

export type Notification = {
  id: string;
  eventType: string;
  channel: string;
  subject: string | null;
  body: string;
  status: "sent" | "failed" | "skipped";
  readAt: string | null;
  createdAt: string;
};

export type DocumentRecord = {
  id: string;
  entityType: string;
  entityId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string | null;
  createdAt: string;
  deletedAt: string | null;
};

export type ScheduledJob = {
  id: string;
  jobCode: string;
  name: string;
  description: string;
  intervalSeconds: number;
  isEnabled: boolean;
  lastRunAt: string | null;
  lastStatus: "running" | "success" | "failed" | null;
  lastDurationMs: number | null;
  lastError: string | null;
};

export type ScheduledJobRun = {
  id: string;
  trigger: "scheduler" | "manual";
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "success" | "failed";
  resultSummary: Record<string, unknown> | null;
  errorMessage: string | null;
};

export type IntegrationEndpoint = {
  id: string;
  code: string;
  name: string;
  direction: "outbound" | "inbound";
  baseUrl: string | null;
  isActive: boolean;
};

export type IntegrationLogEntry = {
  id: string;
  direction: "outbound" | "inbound";
  eventType: string;
  status: "sent" | "failed" | "received" | "rejected";
  createdAt: string;
};

export type DomainEvent = {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
};
