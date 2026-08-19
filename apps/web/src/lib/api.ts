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
  const hasBody = options.body !== undefined;
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      // Only advertise a JSON body when we actually send one — Fastify rejects
      // an empty body when Content-Type is application/json, which would break
      // bodyless POSTs (e.g. publish/submit).
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: hasBody ? JSON.stringify(options.body) : undefined,
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
    request<{ userId: string; tenantId: string; permissions: string[]; scopeTypes: string[] }>("/me", {
      token,
    }),

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

  /** Authenticated download — the download route requires a Bearer token,
   * which a plain <a href> can't send, so fetch the bytes and hand back a
   * Blob the caller can turn into a temporary object URL. */
  downloadDocument: async (token: string, id: string): Promise<Blob> => {
    const response = await fetch(`${API_BASE}/documents/${id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new ApiError(response.status, `Download failed (${response.status})`);
    return response.blob();
  },

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

  // --- Checkpoint 1A: Customer Experience Foundation -------------------------
  // Backend-scoped: `/customers` returns only the customers within the
  // caller's Data Scope (Customer/Organization/Tenant), never the raw table.
  customers: (token: string) => request<Customer[]>("/customers", { token }),

  createCustomer: (
    token: string,
    payload: {
      code: string;
      name: string;
      status?: string;
      ownerOrganizationUnitId?: string | null;
      notes?: string | null;
    },
  ) => request<Customer>("/customers", { method: "POST", token, body: payload }),

  customerContacts: (token: string, customerId: string) =>
    request<CustomerContact[]>(`/customer-contacts?customerId=${customerId}`, { token }),

  createCustomerContact: (
    token: string,
    payload: {
      customerId: string;
      name: string;
      email?: string | null;
      phone?: string | null;
      isPrimary?: boolean;
    },
  ) => request<CustomerContact>("/customer-contacts", { method: "POST", token, body: payload }),

  // --- Checkpoint 1B: Generic Customer Complaint Engine ---------------------
  // Lifecycle/SLA/assignment all live in the Workflow Engine; these methods
  // are the Complaint-specific surface. `actOnComplaint` forwards a
  // Tenant-configured Workflow Transition actionCode verbatim — the set of
  // valid actions is never hardcoded on the client.
  complaintsByCustomer: (token: string, customerId: string) =>
    request<Complaint[]>(`/complaints?customerId=${customerId}`, { token }),

  complaint: (token: string, id: string) =>
    request<{ complaint: Complaint; status: ComplaintStatus | null }>(`/complaints/${id}`, {
      token,
    }),

  // Checkpoint 1C.2 — customer list (status + SLA per row) + composite detail
  // + create-form option catalogs. All read from the real backend.
  complaintsByCustomerSummary: (token: string, customerId: string) =>
    request<ComplaintSummaryItem[]>(`/complaints?customerId=${customerId}&view=summary`, { token }),

  complaintDetail: (token: string, id: string) =>
    request<ComplaintDetailView>(`/complaints/${id}/detail`, { token }),

  complaintReferenceData: (token: string) =>
    request<ComplaintCreateOptions>("/complaints/reference-data", { token }),

  // Checkpoint 1C.3 — operational (internal) queue + detail. Backend restricts
  // both to internal actors; the frontend only reflects the authorized result.
  operationalQueue: (token: string, filters: OperationalQueueFilters = {}) => {
    const params = new URLSearchParams();
    if (filters.assignedToMe) params.set("assignedToMe", "true");
    if (filters.overdue) params.set("overdue", "true");
    if (filters.severity) params.set("severity", filters.severity);
    if (filters.stepCode) params.set("stepCode", filters.stepCode);
    if (filters.customerId) params.set("customerId", filters.customerId);
    if (filters.limit != null) params.set("limit", String(filters.limit));
    if (filters.offset != null) params.set("offset", String(filters.offset));
    const qs = params.toString();
    return request<OperationalQueueResult>(`/complaints/queue${qs ? `?${qs}` : ""}`, { token });
  },

  operationalDetail: (token: string, id: string) =>
    request<OperationalComplaintDetail>(`/complaints/${id}/operational-detail`, { token }),

  // Checkpoint 1C.5 — Management Dashboard (gated on complaint.dashboard.read
  // + Data Scope in the backend; aggregate read-only).
  complaintDashboard: (token: string, filters: DashboardFilters = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v) params.set(k, v);
    }
    const qs = params.toString();
    return request<DashboardResult>(`/complaints/dashboard${qs ? `?${qs}` : ""}`, { token });
  },

  // Checkpoint 1C.6 — Complaint Administration (gated on complaint.configure).
  complaintConfig: (token: string) => request<ComplaintConfigView>("/complaints/config", { token }),

  createComplaintRefItem: (
    token: string,
    typeCode: string,
    item: { code: string; label: string; sortOrder?: number },
  ) =>
    request<ReferenceItemView>(`/complaints/config/reference-data/${typeCode}`, {
      method: "POST",
      token,
      body: item,
    }),

  setComplaintRefItemActive: (token: string, typeCode: string, itemId: string, isActive: boolean) =>
    request<ReferenceItemView>(`/complaints/config/reference-data/${typeCode}/${itemId}`, {
      method: "PATCH",
      token,
      body: { isActive },
    }),

  createComplaint: (token: string, payload: CreateComplaintPayload) =>
    request<Complaint>("/complaints", { method: "POST", token, body: payload }),

  submitComplaint: (token: string, id: string, comment?: string | null) =>
    request(`/complaints/${id}/submit`, { method: "POST", token, body: { comment: comment ?? null } }),

  actOnComplaint: (token: string, id: string, actionCode: string, comment?: string | null) =>
    request(`/complaints/${id}/actions/${actionCode}`, {
      method: "POST",
      token,
      body: { comment: comment ?? null },
    }),

  updateComplaintInvestigation: (
    token: string,
    id: string,
    payload: {
      rootCause?: string | null;
      correctiveAction?: string | null;
      preventiveAction?: string | null;
      correctiveActionOwnerUserId?: string | null;
      correctiveActionTargetDate?: string | null;
    },
  ) => request<Complaint>(`/complaints/${id}/investigation`, { method: "POST", token, body: payload }),

  verifyComplaint: (token: string, id: string, note?: string | null) =>
    request<Complaint>(`/complaints/${id}/verification`, {
      method: "POST",
      token,
      body: { note: note ?? null },
    }),

  confirmComplaintByCustomer: (token: string, id: string, note?: string | null) =>
    request<Complaint>(`/complaints/${id}/customer-confirmation`, {
      method: "POST",
      token,
      body: { note: note ?? null },
    }),

  reopenComplaint: (token: string, id: string, toStepCode: string, comment?: string | null) =>
    request(`/complaints/${id}/reopen`, {
      method: "POST",
      token,
      body: { toStepCode, comment: comment ?? null },
    }),

  // --- Checkpoint 1D: Generic Survey & Assessment Engine --------------------
  // Admin (survey.manage)
  surveys: (token: string) => request<SurveyDefinition[]>("/surveys", { token }),
  survey: (token: string, code: string) => request<SurveyDetail>(`/surveys/${code}`, { token }),
  createSurvey: (token: string, payload: { code: string; name: string; description?: string | null }) =>
    request<{ definition: SurveyDefinition; version: SurveyVersion }>("/surveys", {
      method: "POST",
      token,
      body: payload,
    }),
  createSurveyVersion: (token: string, code: string) =>
    request<SurveyVersion>(`/surveys/${code}/versions`, { method: "POST", token }),
  surveyVersionDetail: (token: string, versionId: string) =>
    request<SurveyVersionDetail>(`/survey-versions/${versionId}`, { token }),
  addSurveyQuestion: (
    token: string,
    versionId: string,
    payload: {
      code: string;
      text: string;
      questionType: string;
      isRequired?: boolean;
      config?: Record<string, unknown>;
      sortOrder?: number;
    },
  ) => request<SurveyQuestion>(`/survey-versions/${versionId}/questions`, { method: "POST", token, body: payload }),
  addSurveyOption: (
    token: string,
    questionId: string,
    payload: { code: string; label: string; score?: number | null; sortOrder?: number },
  ) => request<SurveyQuestionOption>(`/survey-questions/${questionId}/options`, { method: "POST", token, body: payload }),
  publishSurveyVersion: (token: string, code: string, versionNumber: number) =>
    request<SurveyVersion>(`/surveys/${code}/versions/${versionNumber}/publish`, { method: "POST", token }),
  retireSurveyVersion: (token: string, code: string, versionNumber: number) =>
    request<SurveyVersion>(`/surveys/${code}/versions/${versionNumber}/retire`, { method: "POST", token }),
  createSurveyAssignment: (
    token: string,
    payload: {
      surveyDefinitionCode?: string;
      surveyVersionId?: string;
      respondentUserId: string;
      dueAt?: string | null;
    },
  ) => request<SurveyAssignment>("/survey-assignments", { method: "POST", token, body: payload }),
  surveyResult: (token: string, assignmentId: string) =>
    request<SurveyResultView>(`/survey-assignments/${assignmentId}/result`, { token }),

  // Respondent (survey.respond)
  mySurveyAssignments: (token: string) => request<MySurveyItem[]>("/survey-assignments/my", { token }),
  surveyAssignment: (token: string, id: string) =>
    request<SurveyRespondentView>(`/survey-assignments/${id}`, { token }),
  saveSurveyAnswers: (token: string, id: string, answers: SurveyAnswerInput[]) =>
    request<{ ok: boolean }>(`/survey-assignments/${id}/answers`, { method: "POST", token, body: { answers } }),
  submitSurvey: (token: string, id: string) =>
    request<SurveyAssignment>(`/survey-assignments/${id}/submit`, { method: "POST", token }),
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

// --- Checkpoint 1A / 1B domain types (mirror the API contracts) -------------

export type Customer = {
  id: string;
  code: string;
  name: string;
  status: string;
  ownerOrganizationUnitId: string | null;
  notes: string | null;
};

export type CustomerContact = {
  id: string;
  customerId: string;
  name: string;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
};

export type Complaint = {
  id: string;
  complaintNumber: string;
  customerId: string;
  customerContactId: string | null;
  contractId: string | null;
  projectId: string | null;
  siteId: string | null;
  serviceId: string | null;
  category: string;
  subcategory: string | null;
  description: string;
  priority: string;
  severity: string;
  source: string | null;
  channel: string | null;
  submittedByUserId: string;
  submittedAt: string | null;
  rootCause: string | null;
  correctiveAction: string | null;
  preventiveAction: string | null;
  correctiveActionOwnerUserId: string | null;
  correctiveActionTargetDate: string | null;
  verificationNote: string | null;
  verifiedByUserId: string | null;
  verifiedAt: string | null;
  customerConfirmationNote: string | null;
  customerConfirmedAt: string | null;
  closureDate: string | null;
  workflowInstanceId: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Current lifecycle position, resolved from the Complaint's Workflow
 * Instance (never a column on the Complaint itself). */
export type ComplaintStatus = {
  stepCode: string | null;
  instanceStatus: string;
};

// --- Checkpoint 1C.2 composite/customer read types --------------------------

export type ComplaintDetailStatus = {
  stepCode: string | null;
  stepName: string | null;
  instanceStatus: string;
} | null;

export type ComplaintSla = { dueAt: string | null; slaHours: number | null } | null;

export type ComplaintTimelineEntry = {
  occurredAt: string;
  actionCode: string;
  stepCode: string | null;
  stepName: string | null;
};

export type ComplaintAvailableAction = { actionCode: string; name: string };

export type ComplaintDetailView = {
  complaint: Complaint;
  status: ComplaintDetailStatus;
  sla: ComplaintSla;
  timeline: ComplaintTimelineEntry[];
  availableActions: ComplaintAvailableAction[];
  reopen: { canReopen: boolean; targetSteps: { code: string; name: string }[] };
};

export type ComplaintSummaryItem = {
  complaint: Complaint;
  status: ComplaintDetailStatus;
  sla: ComplaintSla;
};

export type ComplaintRefItem = { code: string; label: string };

export type ComplaintCreateOptions = {
  categories: ComplaintRefItem[];
  severities: ComplaintRefItem[];
  priorities: ComplaintRefItem[];
};

// --- Checkpoint 1C.3 operational (internal) types ---------------------------

export type ComplaintAssignmentSummary = {
  roleCode: string | null;
  userId: string | null;
  isMine: boolean;
} | null;

export type OperationalQueueFilters = {
  assignedToMe?: boolean;
  overdue?: boolean;
  severity?: string;
  stepCode?: string;
  customerId?: string;
  limit?: number;
  offset?: number;
};

export type OperationalQueueItem = {
  complaint: Complaint;
  customerName: string | null;
  status: ComplaintDetailStatus;
  sla: ComplaintSla;
  assignment: ComplaintAssignmentSummary;
  overdue: boolean;
};

export type OperationalQueueResult = {
  items: OperationalQueueItem[];
  total: number;
};

export type OperationalTimelineEntry = {
  occurredAt: string;
  actionCode: string;
  fromStepName: string | null;
  toStepName: string | null;
  actorUserId: string | null;
  comment: string | null;
};

export type OperationalComplaintDetail = {
  complaint: Complaint;
  customerName: string | null;
  status: ComplaintDetailStatus;
  sla: ComplaintSla;
  assignment: ComplaintAssignmentSummary;
  timeline: OperationalTimelineEntry[];
  availableActions: { actionCode: string; name: string; toStepCode: string }[];
  reopen: { canReopen: boolean; targetSteps: { code: string; name: string }[] };
};

// --- Checkpoint 1C.5 management dashboard types -----------------------------

export type DashboardFilters = {
  from?: string;
  to?: string;
  customerId?: string;
  siteId?: string;
  serviceId?: string;
  category?: string;
  severity?: string;
};

export type DashboardSummary = {
  total: number;
  open: number;
  closed: number;
  submittedToday: number;
  critical: number;
  slaOverdue: number;
  resolutionRatePercent: number | null;
  avgResolutionHours: number | null;
};

export type BreakdownRow = { key: string; label: string; count: number };

export type DashboardBreakdowns = {
  byCustomer: BreakdownRow[];
  bySite: BreakdownRow[];
  byService: BreakdownRow[];
  byCategory: BreakdownRow[];
  bySeverity: BreakdownRow[];
  byStatus: BreakdownRow[];
};

export type EscalationSummary = { escalatedEvents: number; openEscalatedComplaints: number };

export type ActionCenterItem = {
  complaintId: string;
  complaintNumber: string;
  customerName: string | null;
  severity: string;
  stepCode: string | null;
  stepName: string | null;
  dueAt: string | null;
  overdue: boolean;
  critical: boolean;
};

export type DashboardResult = {
  summary: DashboardSummary;
  breakdowns: DashboardBreakdowns;
  escalation: EscalationSummary;
  actionCenter: ActionCenterItem[];
  period: { from: string; to: string };
  scope: { customerCount: number };
};

// --- Checkpoint 1C.6 admin configuration types ------------------------------

export type ReferenceItemView = {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
};

export type WorkflowCondition = { field: string; operator: string; value: unknown } | null;

export type WorkflowStepView = {
  code: string;
  name: string;
  stepType: string;
  isInitial: boolean;
  isTerminal: boolean;
  terminalStatus: string | null;
  slaHours: number | null;
  transitions: { actionCode: string; name: string; toStepCode: string | null; condition: WorkflowCondition }[];
  assignmentRules: {
    assignmentType: string;
    roleCode: string | null;
    organizationUnitStrategy: string | null;
    specificUserSource: string | null;
    condition: WorkflowCondition;
  }[];
};

export type WorkflowDefinitionView = {
  definition: { code: string; name: string; entityType: string; isActive: boolean };
  versionNumber: number | null;
  versionStatus: string | null;
  steps: WorkflowStepView[];
} | null;

export type ComplaintConfigView = {
  referenceData: {
    categories: ReferenceItemView[];
    severities: ReferenceItemView[];
    priorities: ReferenceItemView[];
  };
  numbering: { code: string; pattern: string; currentSequence: number } | null;
  notificationTemplates: {
    id: string;
    eventType: string;
    channel: string;
    subjectTemplate: string | null;
    isActive: boolean;
  }[];
  workflow: WorkflowDefinitionView;
  capabilities: {
    referenceDataCreate: boolean;
    referenceDataToggleActive: boolean;
    numberingEditable: boolean;
    notificationTemplateEditable: boolean;
    workflowEditable: boolean;
  };
};

export type CreateComplaintPayload = {
  customerId: string;
  customerContactId?: string | null;
  contractId?: string | null;
  projectId?: string | null;
  siteId?: string | null;
  serviceId?: string | null;
  category: string;
  subcategory?: string | null;
  description: string;
  priority: string;
  severity: string;
  source?: string | null;
  channel?: string | null;
};

// --- Checkpoint 1D survey types ---------------------------------------------

export type SurveyVersionStatus = "draft" | "published" | "retired";
export type SurveyQuestionType =
  | "rating"
  | "single_choice"
  | "long_text"
  | "short_text"
  | "multiple_choice"
  | "numeric"
  | "yes_no"
  | "date";
export type SurveyAssignmentStatus = "pending" | "in_progress" | "submitted" | "expired" | "cancelled";

export type SurveyDefinition = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SurveyVersion = {
  id: string;
  surveyDefinitionId: string;
  versionNumber: number;
  status: SurveyVersionStatus;
  isCurrent: boolean;
  publishedAt: string | null;
  createdAt: string;
};

export type SurveySection = {
  id: string;
  surveyVersionId: string;
  code: string;
  title: string;
  description: string | null;
  sortOrder: number;
};

export type SurveyQuestionOption = {
  id: string;
  surveyQuestionId: string;
  code: string;
  label: string;
  score: number | null;
  sortOrder: number;
};

export type SurveyQuestion = {
  id: string;
  surveyVersionId: string;
  sectionId: string | null;
  code: string;
  text: string;
  questionType: SurveyQuestionType;
  isRequired: boolean;
  config: Record<string, unknown>;
  sortOrder: number;
  options?: SurveyQuestionOption[];
};

export type SurveyAssignment = {
  id: string;
  tenantId: string;
  surveyVersionId: string;
  respondentType: string;
  respondentUserId: string | null;
  respondentCustomerContactId: string | null;
  contextEntityType: string | null;
  contextEntityId: string | null;
  status: SurveyAssignmentStatus;
  dueAt: string | null;
  totalScore: number | null;
  assignedBy: string | null;
  createdAt: string;
  submittedAt: string | null;
};

export type SurveyVersionDetail = {
  version: SurveyVersion;
  sections: SurveySection[];
  questions: (SurveyQuestion & { options: SurveyQuestionOption[] })[];
};

export type SurveyDetail = {
  definition: SurveyDefinition;
  versions: SurveyVersion[];
  current: SurveyVersionDetail | null;
};

export type SurveyAnswerView = {
  questionId: string;
  valueText: string | null;
  valueNumeric: number | null;
  selectedOptionIds: string[];
};

export type SurveyRespondentView = {
  assignment: SurveyAssignment;
  sections: SurveySection[];
  questions: (SurveyQuestion & { options: SurveyQuestionOption[] })[];
  answers: SurveyAnswerView[];
};

export type SurveyResultView = {
  assignment: SurveyAssignment;
  version: SurveyVersionDetail | null;
  answers: SurveyAnswerView[];
};

export type SurveyAnswerInput = {
  questionId: string;
  valueText?: string | null;
  valueNumeric?: number | null;
  optionIds?: string[];
};

export type MySurveyItem = {
  assignment: SurveyAssignment;
  surveyName: string | null;
  versionNumber: number | null;
};
