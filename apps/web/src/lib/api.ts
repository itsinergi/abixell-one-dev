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
  // A successful 204 deliberately has no representation. Returning `undefined`
  // keeps `request<void>` truthful instead of leaking the JSON fallback object.
  if (response.status === 204) return undefined as T;
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

  updateCustomer: (
    token: string,
    id: string,
    payload: {
      code?: string;
      name?: string;
      status?: string;
      ownerOrganizationUnitId?: string | null;
      notes?: string | null;
    },
  ) => request<Customer>(`/customers/${id}`, { method: "PATCH", token, body: payload }),

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

  updateCustomerContact: (
    token: string,
    id: string,
    payload: { name?: string; email?: string | null; phone?: string | null; isPrimary?: boolean },
  ) => request<CustomerContact>(`/customer-contacts/${id}`, { method: "PATCH", token, body: payload }),

  contracts: (token: string, customerId: string) =>
    request<ContractRecord[]>(`/contracts?customerId=${customerId}`, { token }),

  createContract: (
    token: string,
    payload: {
      customerId: string;
      code: string;
      name: string;
      startDate?: string | null;
      endDate?: string | null;
      status?: string;
    },
  ) => request<ContractRecord>("/contracts", { method: "POST", token, body: payload }),

  updateContract: (
    token: string,
    id: string,
    payload: { code?: string; name?: string; startDate?: string | null; endDate?: string | null; status?: string },
  ) => request<ContractRecord>(`/contracts/${id}`, { method: "PATCH", token, body: payload }),

  createProject: (
    token: string,
    payload: { customerId: string; contractId?: string | null; code: string; name: string; status?: string },
  ) => request<ProjectRecord>("/projects", { method: "POST", token, body: payload }),

  updateProject: (
    token: string,
    id: string,
    payload: { code?: string; name?: string; status?: string },
  ) => request<ProjectRecord>(`/projects/${id}`, { method: "PATCH", token, body: payload }),

  createSite: (
    token: string,
    payload: {
      customerId: string;
      projectId?: string | null;
      code: string;
      name: string;
      address?: string | null;
      status?: string;
    },
  ) => request<SiteRecord>("/sites", { method: "POST", token, body: payload }),

  updateSite: (
    token: string,
    id: string,
    payload: { code?: string; name?: string; address?: string | null; status?: string },
  ) => request<SiteRecord>(`/sites/${id}`, { method: "PATCH", token, body: payload }),

  commercialServices: (token: string) => request<CommercialService[]>("/services", { token }),

  createCommercialService: (token: string, payload: { code: string; name: string; description?: string | null }) =>
    request<CommercialService>("/services", { method: "POST", token, body: payload }),

  updateCommercialService: (
    token: string,
    id: string,
    payload: { code?: string; name?: string; description?: string | null; isActive?: boolean },
  ) => request<CommercialService>(`/services/${id}`, { method: "PATCH", token, body: payload }),

  customerServiceLinks: (token: string, customerId: string) =>
    request<CustomerServiceLink[]>(`/customer-service-links?customerId=${customerId}`, { token }),

  createCustomerServiceLink: (
    token: string,
    payload: {
      customerId: string;
      serviceId: string;
      contractId?: string | null;
      projectId?: string | null;
      siteId?: string | null;
      internalPicUserId?: string | null;
    },
  ) => request<CustomerServiceLink>("/customer-service-links", { method: "POST", token, body: payload }),

  updateCustomerServiceLink: (token: string, id: string, payload: { status?: string }) =>
    request<CustomerServiceLink>(`/customer-service-links/${id}`, { method: "PATCH", token, body: payload }),

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

  // --- Service Operations & Work Management (Phase 2) -----------------
  serviceDefinitions: (token: string) => request<ServiceDefinition[]>("/service-definitions", { token }),
  serviceDefinition: (token: string, code: string) =>
    request<{ definition: ServiceDefinition; checklist: ServiceChecklistTemplateItem[] }>(
      `/service-definitions/${code}`,
      { token },
    ),
  createServiceDefinition: (
    token: string,
    body: { code: string; name: string; description?: string | null; category?: string | null },
  ) => request<ServiceDefinition>("/service-definitions", { method: "POST", token, body }),
  addServiceChecklistItem: (
    token: string,
    code: string,
    body: { code: string; label: string; isRequired?: boolean; sortOrder?: number },
  ) =>
    request<ServiceChecklistTemplateItem>(`/service-definitions/${code}/checklist-items`, {
      method: "POST",
      token,
      body,
    }),
  setServiceDefinitionActive: (token: string, code: string, isActive: boolean) =>
    request<ServiceDefinition>(`/service-definitions/${code}/active`, {
      method: "PATCH",
      token,
      body: { isActive },
    }),

  workRequests: (token: string) => request<WorkRequestRow[]>("/work-requests", { token }),
  createWorkRequest: (
    token: string,
    body: {
      customerId: string;
      siteId?: string | null;
      serviceDefinitionCode: string;
      description: string;
      priority?: string | null;
    },
  ) => request<WorkRequest>("/work-requests", { method: "POST", token, body }),
  cancelWorkRequest: (token: string, id: string, reason: string | null) =>
    request<WorkRequest>(`/work-requests/${id}/cancel`, { method: "POST", token, body: { reason } }),
  convertWorkRequest: (token: string, id: string, body: { title?: string; dueAt?: string | null }) =>
    request<WorkOrder>(`/work-requests/${id}/convert`, { method: "POST", token, body }),

  workOrders: (token: string) => request<WorkOrderRow[]>("/work-orders", { token }),
  myWorkOrders: (token: string) => request<WorkOrderRow[]>("/work-orders/my", { token }),
  workOrder: (token: string, id: string) => request<WorkOrderDetail>(`/work-orders/${id}`, { token }),
  createWorkOrder: (
    token: string,
    body: {
      customerId: string;
      siteId?: string | null;
      serviceDefinitionCode: string;
      title: string;
      description?: string | null;
      priority?: string | null;
      dueAt?: string | null;
    },
  ) => request<WorkOrder>("/work-orders", { method: "POST", token, body }),
  assignWorkOrder: (token: string, id: string, assigneeUserId: string) =>
    request<WorkOrder>(`/work-orders/${id}/assign`, { method: "POST", token, body: { assigneeUserId } }),
  scheduleWorkOrder: (
    token: string,
    id: string,
    body: { plannedStartAt?: string | null; plannedEndAt?: string | null; dueAt?: string | null },
  ) => request<WorkOrder>(`/work-orders/${id}/schedule`, { method: "POST", token, body }),
  actOnWorkOrder: (token: string, id: string, actionCode: string, comment?: string | null) =>
    request<{ workOrder: WorkOrder }>(`/work-orders/${id}/actions/${actionCode}`, {
      method: "POST",
      token,
      body: { comment: comment ?? null },
    }),
  startWorkOrder: (token: string, id: string) =>
    request<WorkOrder>(`/work-orders/${id}/start`, { method: "POST", token }),
  setWorkOrderChecklistItem: (
    token: string,
    id: string,
    itemId: string,
    body: { isCompleted: boolean; note?: string | null },
  ) => request<WorkOrderChecklistItem>(`/work-orders/${id}/checklist/${itemId}`, { method: "POST", token, body }),
  completeWorkOrder: (token: string, id: string, notes: string | null) =>
    request<WorkOrder>(`/work-orders/${id}/complete`, { method: "POST", token, body: { notes } }),
  verifyWorkOrder: (token: string, id: string, notes: string | null) =>
    request<WorkOrder>(`/work-orders/${id}/verify`, { method: "POST", token, body: { notes } }),

  // --- Workforce / HR (Phase 3) ---------------------------------------
  positions: (token: string) => request<PositionRecord[]>("/positions", { token }),
  createPosition: (token: string, body: { code: string; name: string; description?: string | null }) =>
    request<PositionRecord>("/positions", { method: "POST", token, body }),
  setPositionActive: (token: string, code: string, isActive: boolean) =>
    request<PositionRecord>(`/positions/${code}/active`, { method: "PATCH", token, body: { isActive } }),

  employees: (token: string, query: { search?: string; employmentStatus?: string } = {}) => {
    const params = new URLSearchParams();
    if (query.search) params.set("search", query.search);
    if (query.employmentStatus) params.set("employmentStatus", query.employmentStatus);
    const qs = params.toString();
    return request<Employee[]>(`/employees${qs ? `?${qs}` : ""}`, { token });
  },
  employee: (token: string, id: string) => request<EmployeeDetail>(`/employees/${id}`, { token }),
  myEmployeeRecord: (token: string) => request<EmployeeDetail>("/employees/me", { token }),
  createEmployee: (
    token: string,
    body: {
      employeeNumber?: string;
      fullName: string;
      email?: string | null;
      phone?: string | null;
      employmentType?: string | null;
      joinedAt?: string | null;
      legalEntityId?: string | null;
      organizationUnitId?: string | null;
      positionCode?: string | null;
    },
  ) => request<Employee>("/employees", { method: "POST", token, body }),
  updateEmployeeProfile: (
    token: string,
    id: string,
    body: { fullName?: string; email?: string | null; phone?: string | null; employmentType?: string | null },
  ) => request<Employee>(`/employees/${id}`, { method: "PATCH", token, body }),
  changeEmployeePlacement: (
    token: string,
    id: string,
    body: {
      legalEntityId?: string | null;
      organizationUnitId?: string | null;
      positionCode?: string | null;
      employmentStatus?: string;
      effectiveFrom?: string;
      note?: string | null;
    },
  ) => request<EmployeeDetail>(`/employees/${id}/placement`, { method: "POST", token, body }),
  setEmployeeUserLink: (token: string, id: string, userId: string | null) =>
    request<Employee>(`/employees/${id}/user-link`, { method: "POST", token, body: { userId } }),

  // --- Supply Chain (Phase 4) -----------------------------------------
  scmItems: (token: string, query: { search?: string } = {}) => {
    const qs = query.search ? `?search=${encodeURIComponent(query.search)}` : "";
    return request<ScmItem[]>(`/items${qs}`, { token });
  },
  scmItem: (token: string, code: string) =>
    request<{ item: ScmItem; balances: StockBalanceRecord[] }>(`/items/${code}`, { token }),
  createScmItem: (
    token: string,
    body: { code: string; name: string; description?: string | null; category?: string | null; unitOfMeasure: string },
  ) => request<ScmItem>("/items", { method: "POST", token, body }),
  updateScmItem: (token: string, code: string, body: { name?: string; isActive?: boolean }) =>
    request<ScmItem>(`/items/${code}`, { method: "PATCH", token, body }),

  suppliers: (token: string, query: { search?: string } = {}) => {
    const qs = query.search ? `?search=${encodeURIComponent(query.search)}` : "";
    return request<SupplierRecord[]>(`/suppliers${qs}`, { token });
  },
  createSupplier: (
    token: string,
    body: { code: string; name: string; contactName?: string | null; email?: string | null; phone?: string | null },
  ) => request<SupplierRecord>("/suppliers", { method: "POST", token, body }),

  stockBalances: (token: string, query: { itemCode?: string } = {}) => {
    const qs = query.itemCode ? `?itemCode=${encodeURIComponent(query.itemCode)}` : "";
    return request<StockBalanceRecord[]>(`/stock/balances${qs}`, { token });
  },
  stockMovements: (token: string, query: { itemCode?: string } = {}) => {
    const qs = query.itemCode ? `?itemCode=${encodeURIComponent(query.itemCode)}` : "";
    return request<StockMovementRecord[]>(`/stock/movements${qs}`, { token });
  },
  recordGoodsIn: (
    token: string,
    body: { itemCode: string; quantity: number; siteId?: string | null; reference?: string | null },
  ) => request<StockMovementResult>("/stock/goods-in", { method: "POST", token, body }),
  recordGoodsOut: (
    token: string,
    body: { itemCode: string; quantity: number; siteId?: string | null; reference?: string | null },
  ) => request<StockMovementResult>("/stock/goods-out", { method: "POST", token, body }),

  purchaseRequests: (token: string) => request<PurchaseRequestRecord[]>("/purchase-requests", { token }),
  purchaseRequest: (token: string, id: string) =>
    request<PurchaseRequestDetail>(`/purchase-requests/${id}`, { token }),
  createPurchaseRequest: (
    token: string,
    body: {
      justification: string;
      organizationUnitId?: string | null;
      requiredDate?: string | null;
      lines: { itemCode: string; quantity: number; note?: string | null }[];
    },
  ) => request<PurchaseRequestDetail>("/purchase-requests", { method: "POST", token, body }),
  actOnPurchaseRequest: (token: string, id: string, actionCode: string, comment?: string | null) =>
    request<{ request: PurchaseRequestRecord }>(`/purchase-requests/${id}/actions/${actionCode}`, {
      method: "POST",
      token,
      body: { comment: comment ?? null },
    }),

  purchaseOrders: (token: string) => request<PurchaseOrderRecord[]>("/purchase-orders", { token }),
  purchaseOrder: (token: string, id: string) => request<PurchaseOrderDetail>(`/purchase-orders/${id}`, { token }),
  createPurchaseOrder: (
    token: string,
    body: {
      supplierCode: string;
      purchaseRequestId?: string | null;
      currency?: string | null;
      expectedDate?: string | null;
      lines?: { itemCode: string; quantity: number; unitPrice?: number | null }[];
    },
  ) => request<PurchaseOrderDetail>("/purchase-orders", { method: "POST", token, body }),
  issuePurchaseOrder: (token: string, id: string) =>
    request<PurchaseOrderDetail>(`/purchase-orders/${id}/issue`, { method: "POST", token }),
  receiveAgainstOrder: (
    token: string,
    id: string,
    body: { lineId: string; quantity: number; note?: string | null },
  ) => request<StockMovementResult>(`/purchase-orders/${id}/receipts`, { method: "POST", token, body }),

  // --- Asset (Phase 5) --------------------------------------------------
  assets: (token: string, query: AssetQuery = {}) => {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "" && value !== false) qs.set(key, String(value));
    }
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<AssetListResult>(`/assets${suffix}`, { token });
  },
  asset: (token: string, id: string) => request<AssetDetail>(`/assets/${id}`, { token }),
  createAsset: (token: string, body: CreateAssetBody) =>
    request<AssetDetail>("/assets", { method: "POST", token, body }),
  updateAsset: (token: string, id: string, body: UpdateAssetBody) =>
    request<AssetDetail>(`/assets/${id}`, { method: "PATCH", token, body }),
  moveAsset: (token: string, id: string, body: MoveAssetBody) =>
    request<AssetDetail>(`/assets/${id}/movements`, { method: "POST", token, body }),
  changeAssetStatus: (
    token: string,
    id: string,
    body: { status: AssetStatusValue; reason?: string | null; effectiveDate?: string | null },
  ) => request<AssetDetail>(`/assets/${id}/status`, { method: "POST", token, body }),
  retireAsset: (
    token: string,
    id: string,
    body: { status?: "retired" | "disposed"; reason?: string | null; effectiveDate?: string | null },
  ) => request<AssetDetail>(`/assets/${id}/retirement`, { method: "POST", token, body }),
  actOnAssetMovement: (token: string, movementId: string, actionCode: string, comment?: string | null) =>
    request<AssetDetail>(`/asset-movements/${movementId}/actions/${actionCode}`, {
      method: "POST",
      token,
      body: { comment: comment ?? null },
    }),

  // Location pickers reuse the existing Customer & Commercial hierarchy —
  // Asset never owns its own site or project master.
  sitesForCustomer: (token: string, customerId: string) =>
    request<SiteRecord[]>(`/sites?customerId=${customerId}`, { token }),
  projectsForCustomer: (token: string, customerId: string) =>
    request<ProjectRecord[]>(`/projects?customerId=${customerId}`, { token }),

  // --- Finance (Phase 6) ------------------------------------------------
  // Every amount below is a STRING, deliberately: money must never pass
  // through a JavaScript number on its way to or from the API.
  financeAccounts: (token: string, query: { activeOnly?: boolean } = {}) =>
    request<FinanceAccount[]>(`/finance/accounts${query.activeOnly ? "?activeOnly=true" : ""}`, { token }),
  financeAccount: (token: string, code: string) =>
    request<FinanceAccount>(`/finance/accounts/${encodeURIComponent(code)}`, { token }),
  createFinanceAccount: (token: string, body: CreateFinanceAccountBody) =>
    request<FinanceAccount>("/finance/accounts", { method: "POST", token, body }),
  updateFinanceAccount: (
    token: string,
    code: string,
    body: { name?: string; description?: string | null; isActive?: boolean },
  ) => request<FinanceAccount>(`/finance/accounts/${encodeURIComponent(code)}`, { method: "PATCH", token, body }),

  financeCategories: (token: string) =>
    request<{ code: string; label: string }[]>("/finance/categories", { token }),

  financeTransactions: (token: string, query: FinanceTransactionQuery = {}) => {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") qs.set(key, String(value));
    }
    return request<FinanceTransactionRecord[]>(`/finance/transactions${qs.toString() ? `?${qs}` : ""}`, { token });
  },
  financeTransaction: (token: string, id: string) =>
    request<FinanceTransactionDetail>(`/finance/transactions/${id}`, { token }),
  recordFinanceTransaction: (token: string, body: RecordFinanceTransactionBody) =>
    request<FinanceTransactionDetail>("/finance/transactions", { method: "POST", token, body }),
  actOnFinanceTransaction: (token: string, id: string, actionCode: string, comment?: string | null) =>
    request<FinanceTransactionDetail>(`/finance/transactions/${id}/actions/${actionCode}`, {
      method: "POST",
      token,
      body: { comment: comment ?? null },
    }),
  reverseFinanceTransaction: (
    token: string,
    id: string,
    body: { reason?: string | null; transactionDate?: string | null } = {},
  ) => request<FinanceTransactionDetail>(`/finance/transactions/${id}/reversal`, { method: "POST", token, body }),

  financeCashflow: (token: string, query: { from: string; to: string; accountCode?: string }) => {
    const qs = new URLSearchParams({ from: query.from, to: query.to });
    if (query.accountCode) qs.set("accountCode", query.accountCode);
    return request<CashflowResult>(`/finance/cashflow?${qs}`, { token });
  },

  // --- Reporting & Operational Insight (Phase 9) ------------------------
  reportingReports: (token: string) => request<ReportDefinition[]>("/reporting/reports", { token }),
  reportingReport: (token: string, code: string) =>
    request<StandardReportResult>(`/reporting/reports/${encodeURIComponent(code)}`, { token }),
  reportingDashboard: (token: string) => request<ExecutiveDashboard>("/reporting/dashboard", { token }),
  exportReportingReport: async (token: string, code: string): Promise<{ filename: string; content: string }> => {
    const response = await fetch(`${API_BASE}/reporting/reports/${encodeURIComponent(code)}/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const content = await response.text();
    if (!response.ok) throw new ApiError(response.status, content || `Export failed (${response.status})`);
    const disposition = response.headers.get("content-disposition") ?? "";
    const filename = disposition.match(/filename="?([^";]+)"?/)?.[1] ?? `${code}.csv`;
    return { filename, content };
  },

  // --- Project Delivery (Phase 8) --------------------------------------
  projectDeliveryProjects: (token: string) =>
    request<ProjectDeliveryProjectSummary[]>("/project-delivery/projects", { token }),
  projectDeliveryDetail: (token: string, projectId: string) =>
    request<ProjectDeliveryDetail>(`/project-delivery/projects/${projectId}`, { token }),
  createProjectDeliveryActivity: (token: string, projectId: string, body: CreateProjectDeliveryActivityBody) =>
    request<ProjectDeliveryActivity>(`/project-delivery/projects/${projectId}/activities`, { method: "POST", token, body }),
  updateProjectDeliveryActivity: (token: string, id: string, body: UpdateProjectDeliveryActivityBody) =>
    request<ProjectDeliveryActivity>(`/project-delivery/activities/${id}`, { method: "PATCH", token, body }),
  createProjectDeliveryMilestone: (token: string, projectId: string, body: CreateProjectDeliveryMilestoneBody) =>
    request<ProjectDeliveryMilestone>(`/project-delivery/projects/${projectId}/milestones`, { method: "POST", token, body }),
  updateProjectDeliveryMilestone: (token: string, id: string, body: UpdateProjectDeliveryMilestoneBody) =>
    request<ProjectDeliveryMilestone>(`/project-delivery/milestones/${id}`, { method: "PATCH", token, body }),

  // --- HSE (Phase 7) ---------------------------------------------------
  hseRecords: (token: string, query: HseRecordQuery = {}) => {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") qs.set(key, String(value));
    }
    return request<HseRecord[]>(`/hse/records${qs.toString() ? `?${qs}` : ""}`, { token });
  },
  hseRecord: (token: string, id: string) =>
    request<HseRecordDetail>(`/hse/records/${id}`, { token }),
  reportHseRecord: (token: string, body: ReportHseRecordBody) =>
    request<HseRecord>("/hse/records", { method: "POST", token, body }),
  updateHseRecord: (token: string, id: string, body: UpdateHseRecordBody) =>
    request<HseRecord>(`/hse/records/${id}`, { method: "PATCH", token, body }),
  startHseRecordLifecycle: (token: string, id: string) =>
    request<HseRecord>(`/hse/records/${id}/lifecycle`, { method: "POST", token }),
  actOnHseRecord: (token: string, id: string, actionCode: string, comment?: string | null) =>
    request<HseRecord>(`/hse/records/${id}/actions/${actionCode}`, {
      method: "POST",
      token,
      body: { comment: comment ?? null },
    }),
  addHsePersonInvolved: (token: string, recordId: string, body: AddHsePersonBody) =>
    request<HsePersonInvolved>(`/hse/records/${recordId}/persons`, { method: "POST", token, body }),
  createHseFollowUp: (token: string, recordId: string, body: CreateHseFollowUpBody) =>
    request<HseFollowUp>(`/hse/records/${recordId}/follow-ups`, { method: "POST", token, body }),
  completeHseFollowUp: (token: string, recordId: string, followUpId: string, body: CompleteHseFollowUpBody) =>
    request<HseFollowUp>(`/hse/records/${recordId}/follow-ups/${followUpId}/complete`, { method: "POST", token, body }),

  // --- Business Admin Console (Phase 11C/11F) ---------------------------
  adminOverview: (token: string) => request<AdminOverview>("/admin/overview", { token }),
  adminUsers: (token: string) => request<AdminUserAccessSummary[]>("/admin/users", { token }),
  adminRoles: (token: string) => request<AdminRoleSummary[]>("/admin/roles", { token }),
  adminRolePermissions: (token: string, roleCode: string) =>
    request<AdminRolePermissions>(`/admin/roles/${encodeURIComponent(roleCode)}/permissions`, { token }),
  addAdminUserRoleAssignment: (
    token: string,
    userId: string,
    body: AdminRoleAssignmentInput,
  ) =>
    request<AdminRoleAssignmentSummary>(`/admin/users/${encodeURIComponent(userId)}/role-assignments`, {
      method: "POST",
      token,
      body,
    }),
  deleteAdminUserRoleAssignment: (
    token: string,
    userId: string,
    assignmentId: string,
  ) =>
    request<void>(
      `/admin/users/${encodeURIComponent(userId)}/role-assignments/${encodeURIComponent(assignmentId)}`,
      {
        method: "DELETE",
        token,
      },
    ),
  adminPermissions: (token: string) => request<AdminPermission[]>("/admin/permissions", { token }),
  adminModules: (token: string) => request<AdminModuleSummary[]>("/admin/modules", { token }),
  adminWorkflows: (token: string) => request<AdminWorkflowSummary[]>("/admin/workflows", { token }),
  adminRecentAudit: (token: string) => request<AdminAuditEntry[]>("/admin/audit/recent", { token }),

  // --- Wave A1: Sales & Pipeline (CUS-ADV-001) ------------------------------
  salesReferenceOptions: (token: string) =>
    request<{ stages: { code: string; label: string }[]; sources: { code: string; label: string }[]; units: { code: string; label: string }[] }>("/sales/reference-data", { token }),
  priceBooks: (token: string) => request<PriceBookRecord[]>("/sales/price-books", { token }),
  createPriceBook: (token: string, body: CreatePriceBookBody) =>
    request<PriceBookRecord>("/sales/price-books", { method: "POST", token, body }),
  priceBookEntries: (token: string, priceBookId: string) =>
    request<PriceBookEntryRecord[]>(`/sales/price-books/${priceBookId}/entries`, { token }),
  addPriceBookEntry: (token: string, priceBookId: string, body: AddPriceBookEntryBody) =>
    request<PriceBookEntryRecord>(`/sales/price-books/${priceBookId}/entries`, { method: "POST", token, body }),
  opportunities: (token: string, query?: { outcome?: string; stageCode?: string; customerId?: string }) => {
    const qs = new URLSearchParams();
    if (query?.outcome) qs.set("outcome", query.outcome);
    if (query?.stageCode) qs.set("stageCode", query.stageCode);
    if (query?.customerId) qs.set("customerId", query.customerId);
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<OpportunityRecord[]>(`/sales/opportunities${suffix}`, { token });
  },
  opportunityPipeline: (token: string) =>
    request<OpportunityPipelineSummary[]>("/sales/opportunities/pipeline", { token }),
  opportunity: (token: string, id: string) =>
    request<OpportunityDetailRecord>(`/sales/opportunities/${id}`, { token }),
  createOpportunity: (token: string, body: CreateOpportunityBody) =>
    request<OpportunityRecord>("/sales/opportunities", { method: "POST", token, body }),
  changeOpportunityStage: (token: string, id: string, body: { stageCode: string; outcome?: string; outcomeReason?: string | null; note?: string | null }) =>
    request<OpportunityRecord>(`/sales/opportunities/${id}/stage`, { method: "POST", token, body }),
  quotations: (token: string) => request<QuotationRecord[]>("/sales/quotations", { token }),
  quotation: (token: string, id: string) =>
    request<QuotationDetailRecord>(`/sales/quotations/${id}`, { token }),
  createQuotation: (token: string, body: CreateQuotationBody) =>
    request<QuotationDetailRecord>("/sales/quotations", { method: "POST", token, body }),
  submitQuotationForApproval: (token: string, id: string) =>
    request<QuotationRecord>(`/sales/quotations/${id}/submit`, { method: "POST", token }),
  recordQuotationApproval: (token: string, id: string, decision: "issued" | "withdrawn") =>
    request<QuotationRecord>(`/sales/quotations/${id}/approval`, { method: "POST", token, body: { decision } }),
  recordQuotationCustomerDecision: (token: string, id: string, body: { decision: "accepted" | "declined"; note?: string | null }) =>
    request<QuotationRecord>(`/sales/quotations/${id}/customer-decision`, { method: "POST", token, body }),

  // --- Wave A1: Service Quality Advanced (SQ-ADV-001…004) ------------------
  sqCalendars: (token: string) =>
    request<{ calendar: SqCalendarRecord; windows: SqCalendarWindow[]; holidays: SqHolidayRecord[] }[]>("/service-quality/calendars", { token }),
  createSqCalendar: (token: string, body: CreateSqCalendarBody) =>
    request<{ calendar: SqCalendarRecord; windows: SqCalendarWindow[] }>("/service-quality/calendars", { method: "POST", token, body }),
  addSqHoliday: (token: string, calendarId: string, body: { holidayDate: string; name: string }) =>
    request<SqHolidayRecord>(`/service-quality/calendars/${calendarId}/holidays`, { method: "POST", token, body }),
  sqSlaPolicies: (token: string) =>
    request<{ policy: SqSlaPolicyRecord; calendar: SqCalendarRecord | null; rules: SqSlaRuleRecord[] }[]>("/service-quality/sla-policies", { token }),
  createSqSlaPolicy: (token: string, body: CreateSqSlaPolicyBody) =>
    request<SqSlaPolicyRecord>("/service-quality/sla-policies", { method: "POST", token, body }),
  createSqSlaRule: (token: string, body: CreateSqSlaRuleBody) =>
    request<SqSlaRuleRecord>("/service-quality/sla-rules", { method: "POST", token, body }),
  sqSlaPerformance: (token: string) =>
    request<SqSlaPerformanceSummary[]>("/service-quality/sla-performance", { token }),
  sqComplaintSla: (token: string, complaintId: string) =>
    request<{ target: SqSlaTargetRecord | null; state: SqSlaTargetState | null }>(`/service-quality/complaints/${complaintId}/sla`, { token }),
  sqRcaCategories: (token: string) =>
    request<SqRcaCategoryRecord[]>("/service-quality/rca/categories", { token }),
  createSqRcaCategory: (token: string, body: CreateSqRcaCategoryBody) =>
    request<SqRcaCategoryRecord>("/service-quality/rca/categories", { method: "POST", token, body }),
  sqComplaintRcaFindings: (token: string, complaintId: string) =>
    request<SqRcaFindingRecord[]>(`/service-quality/complaints/${complaintId}/rca/findings`, { token }),
  recordSqRcaFinding: (token: string, complaintId: string, body: CreateSqRcaFindingBody) =>
    request<SqRcaFindingRecord>(`/service-quality/complaints/${complaintId}/rca/findings`, { method: "POST", token, body }),
  clearSqPrimaryRcaFinding: (token: string, complaintId: string) =>
    request<void>(`/service-quality/complaints/${complaintId}/rca/primary`, { method: "DELETE", token }),
  sqCapaActions: (token: string) =>
    request<SqCapaActionRecord[]>("/service-quality/capa/actions", { token }),
  sqComplaintCapaActions: (token: string, complaintId: string) =>
    request<SqCapaActionRecord[]>(`/service-quality/complaints/${complaintId}/capa/actions`, { token }),
  createSqCapaAction: (token: string, body: CreateSqCapaActionBody) =>
    request<SqCapaActionRecord>("/service-quality/capa/actions", { method: "POST", token, body }),
  updateSqCapaStatus: (token: string, id: string, body: { status: string; completionNote?: string }) =>
    request<SqCapaActionRecord>(`/service-quality/capa/actions/${id}/status`, { method: "PATCH", token, body }),
  verifySqCapaEffectiveness: (token: string, id: string, body: { verdict: "effective" | "ineffective"; note?: string | null }) =>
    request<SqCapaActionRecord>(`/service-quality/capa/actions/${id}/verify`, { method: "POST", token, body }),
  sqCapaEffectivenessSummary: (token: string) =>
    request<SqCapaEffectivenessSummary[]>("/service-quality/capa/effectiveness-summary", { token }),
  sqRecurrenceRules: (token: string) =>
    request<SqRecurrenceRuleRecord[]>("/service-quality/recurrence/rules", { token }),
  createSqRecurrenceRule: (token: string, body: CreateSqRecurrenceRuleBody) =>
    request<SqRecurrenceRuleRecord>("/service-quality/recurrence/rules", { method: "POST", token, body }),
  detectSqRecurrence: (token: string, ruleId: string) =>
    request<SqRecurrenceDetectionRecord>(`/service-quality/recurrence/rules/${ruleId}/detection`, { token }),
  sqAutomationRules: (token: string) =>
    request<SqAutomationRuleRecord[]>("/service-quality/automation/rules", { token }),
  createSqAutomationRule: (token: string, body: CreateSqAutomationRuleBody) =>
    request<SqAutomationRuleRecord>("/service-quality/automation/rules", { method: "POST", token, body }),
  setSqAutomationRuleActive: (token: string, id: string, isActive: boolean) =>
    request<SqAutomationRuleRecord>(`/service-quality/automation/rules/${id}/active`, { method: "PATCH", token, body: { isActive } }),
  sqAutomationProposals: (token: string, status?: string) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return request<SqAutomationProposalRecord[]>(`/service-quality/automation/proposals${qs}`, { token });
  },
  sqAutomationProposal: (token: string, id: string) =>
    request<SqAutomationProposalRecord>(`/service-quality/automation/proposals/${id}`, { token }),
  approveSqAutomationProposal: (token: string, id: string, note?: string | null) =>
    request<SqAutomationProposalRecord>(`/service-quality/automation/proposals/${id}/approve`, { method: "POST", token, body: { note } }),
  rejectSqAutomationProposal: (token: string, id: string, note: string) =>
    request<SqAutomationProposalRecord>(`/service-quality/automation/proposals/${id}/reject`, { method: "POST", token, body: { note } }),
};

// --- Business Admin Console types (Phase 11C) ---------------------------

export type AdminSectionAccess = {
  visible: boolean;
  /** Surfaced so the UI can name the permission a denied section needs. */
  requiredPermission: string;
};

/** `count` is null — not zero — when the section is not visible, so the UI
 * never renders a misleading "0". */
export type AdminCountSection = AdminSectionAccess & { count: number | null };

export type AdminOverview = {
  tenantId: string;
  sections: {
    users: AdminCountSection;
    roles: AdminCountSection;
    permissions: AdminCountSection;
    modules: AdminCountSection & { activeCount: number | null };
    workflows: AdminCountSection;
    audit: AdminCountSection;
  };
  capabilities: {
    userRoleManage: boolean;
    userAccessRead: boolean;
    rolePermissionRead: boolean;
    readOnly: boolean;
    userManage: false;
    roleManage: false;
    permissionManage: false;
    moduleActivationManage: false;
    workflowManage: false;
  };
};

export type AdminRoleAssignmentScopeType =
  | "tenant"
  | "organization_unit"
  | "customer";

export type AdminRoleAssignmentSummary = {
  id: string;
  roleState: "available" | "unavailable";
  roleCode: string | null;
  roleName: string | null;
  scopeType: AdminRoleAssignmentScopeType;
  scopeState: "available" | "unavailable";
  scopeOrganizationUnitId: string | null;
  scopeOrganizationUnitName: string | null;
  scopeCustomerId: string | null;
  scopeCustomerName: string | null;
};

export type AdminUserAccessSummary = {
  id: string;
  fullName: string;
  email: string;
  status: string;
  roleAssignments: AdminRoleAssignmentSummary[];
};

export type AdminRoleAssignmentInput =
  | { roleCode: string; scopeType: "tenant" }
  | {
      roleCode: string;
      scopeType: "organization_unit";
      scopeOrganizationUnitId: string;
    }
  | { roleCode: string; scopeType: "customer"; scopeCustomerId: string };

export type AdminRoleSummary = {
  code: string;
  name: string;
  isFullAccess: boolean;
  permissionCount: number;
  assignedUserCount: number;
};

export type AdminRolePermissions = {
  roleCode: string;
  roleName: string;
  isFullAccess: boolean;
  permissions: AdminPermission[];
};

export type AdminPermission = { code: string; description: string };

export type AdminModuleSummary = {
  moduleCode: string;
  moduleName: string;
  isActive: boolean;
};

export type AdminWorkflowSummary = {
  code: string;
  name: string;
  entityType: string;
  isActive: boolean;
};

/** Privacy-safe: carries no audit `metadata` and no `entityId`. */
export type AdminAuditEntry = {
  id: string;
  action: string;
  entityType: string;
  actorUserId: string | null;
  createdAt: string;
};

// --- Reporting & Operational Insight types (Phase 9) --------------------

export type ReportModuleCode =
  | "customer_commercial"
  | "customer_complaint"
  | "survey_assessment"
  | "service_operations"
  | "workforce"
  | "supply_chain"
  | "asset"
  | "finance"
  | "hse"
  | "project_delivery";

export type ReportColumnType = "text" | "number" | "money" | "percent";

export type ReportDefinition = {
  code: string;
  title: string;
  description: string;
  moduleCode: ReportModuleCode;
  requiredPermission: string;
};

export type ReportColumn = {
  key: string;
  label: string;
  type: ReportColumnType;
};

export type ReportRow = {
  label: string;
  [key: string]: string | number | null;
};

export type StandardReportResult = {
  code: string;
  title: string;
  moduleCode: ReportModuleCode;
  moduleName: string;
  generatedAt: string;
  columns: ReportColumn[];
  summary: Record<string, string | number>;
  rows: ReportRow[];
};

export type DashboardCard = {
  label: string;
  value: string | number;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
};

export type DashboardModule = {
  moduleCode: ReportModuleCode;
  moduleName: string;
  cards: DashboardCard[];
};

export type ExecutiveDashboard = {
  generatedAt: string;
  modules: DashboardModule[];
};

// --- Finance types (Phase 6) -------------------------------------------

/** Money is a string end to end — see the module PRD and finance.entity.ts. */
export type Money = string;

export type FinanceAccountType = "cash" | "bank" | "petty_cash";
export type TransactionDirection = "income" | "expense";

export type FinanceAccount = {
  id: string;
  code: string;
  name: string;
  accountType: FinanceAccountType;
  currency: string;
  description: string | null;
  legalEntityId: string | null;
  organizationUnitId: string | null;
  balance: Money;
  isActive: boolean;
};

export type FinanceTransactionRecord = {
  id: string;
  transactionNumber: string;
  direction: TransactionDirection;
  amount: Money;
  currency: string;
  transactionDate: string;
  accountId: string;
  categoryCode: string;
  description: string | null;
  reference: string | null;
  organizationUnitId: string | null;
  projectId: string | null;
  siteId: string | null;
  customerId: string | null;
  workflowInstanceId: string | null;
  appliedAt: string | null;
  reversesTransactionId: string | null;
  reversedByTransactionId: string | null;
};

export type FinanceTransactionDetail = {
  transaction: FinanceTransactionRecord;
  account: FinanceAccount | null;
  status: { stepCode: string | null; stepName: string | null; instanceStatus: string } | null;
  availableActions: { actionCode: string; name: string; toStepCode: string }[];
  isApplied: boolean;
};

export type CashflowResult = {
  from: string;
  to: string;
  opening: Money;
  totals: { income: Money; expense: Money; net: Money };
  closing: Money;
  byCategory: { categoryCode: string; direction: TransactionDirection; amount: Money }[];
  accounts: FinanceAccount[];
};

export type FinanceTransactionQuery = {
  direction?: string;
  accountCode?: string;
  categoryCode?: string;
  customerId?: string;
  projectId?: string;
  organizationUnitId?: string;
  dateFrom?: string;
  dateTo?: string;
  state?: string;
  search?: string;
};

export type CreateFinanceAccountBody = {
  code: string;
  name: string;
  accountType: FinanceAccountType;
  currency: string;
  description?: string | null;
  legalEntityId?: string | null;
  organizationUnitId?: string | null;
};

export type RecordFinanceTransactionBody = {
  direction: TransactionDirection;
  /** A string, always. */
  amount: Money;
  transactionDate: string;
  accountCode: string;
  categoryCode: string;
  description?: string | null;
  reference?: string | null;
  organizationUnitId?: string | null;
  projectId?: string | null;
  siteId?: string | null;
  customerId?: string | null;
};

// --- Project Delivery types (Phase 8) -----------------------------------

export type ProjectDeliveryActivityStatus = "planned" | "in_progress" | "completed" | "on_hold" | "cancelled";
export type ProjectDeliveryMilestoneStatus = "pending" | "achieved" | "missed" | "cancelled";

export type ProjectDeliveryProject = {
  id: string;
  tenantId: string;
  customerId: string;
  code: string;
  name: string;
  status: string;
  ownerOrganizationUnitId: string | null;
};

export type ProjectDeliveryProgress = {
  projectId: string;
  activityCount: number;
  completedActivityCount: number;
  progressPercent: number;
  milestoneCount: number;
  achievedMilestoneCount: number;
};

export type ProjectDeliveryActivity = {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  description: string | null;
  activityTypeCode: string | null;
  picUserId: string | null;
  picEmployeeId: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  status: ProjectDeliveryActivityStatus;
  progressPercent: number;
};

export type ProjectDeliveryMilestone = {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  description: string | null;
  milestoneTypeCode: string | null;
  plannedDate: string | null;
  status: ProjectDeliveryMilestoneStatus;
  achievedAt: string | null;
  achievedByUserId: string | null;
  achievementNote: string | null;
};

export type ProjectDeliveryProjectSummary = {
  project: ProjectDeliveryProject;
  progress: ProjectDeliveryProgress;
};

export type ProjectDeliveryDetail = ProjectDeliveryProjectSummary & {
  activities: ProjectDeliveryActivity[];
  milestones: ProjectDeliveryMilestone[];
};

export type CreateProjectDeliveryActivityBody = {
  title: string;
  description?: string | null;
  activityTypeCode?: string | null;
  picUserId?: string | null;
  picEmployeeId?: string | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
  status?: ProjectDeliveryActivityStatus;
  progressPercent?: number;
};

export type UpdateProjectDeliveryActivityBody = Partial<CreateProjectDeliveryActivityBody>;

export type CreateProjectDeliveryMilestoneBody = {
  title: string;
  description?: string | null;
  milestoneTypeCode?: string | null;
  plannedDate?: string | null;
  status?: ProjectDeliveryMilestoneStatus;
};

export type UpdateProjectDeliveryMilestoneBody = Partial<CreateProjectDeliveryMilestoneBody> & {
  achievementNote?: string | null;
};

// --- HSE types (Phase 7) -----------------------------------------------

export type HseRecordType = "incident" | "observation";

export type HseRecord = {
  id: string;
  recordNumber: string;
  recordType: HseRecordType;
  categoryCode: string | null;
  severityCode: string | null;
  occurredAt: string;
  reportedAt: string;
  title: string;
  summary: string | null;
  description: string | null;
  immediateAction: string | null;
  organizationUnitId: string | null;
  projectId: string | null;
  siteId: string | null;
  locationDetail: string | null;
  reportedByUserId: string;
  responsibleUserId: string | null;
  responsibleOrgUnitId: string | null;
  workflowInstanceId: string | null;
};

export type HsePersonInvolved = {
  id: string;
  hseRecordId: string;
  employeeId: string | null;
  personName: string | null;
  personRole: string | null;
  createdAt: string;
};

export type HseFollowUp = {
  id: string;
  hseRecordId: string;
  title: string;
  description: string | null;
  assignedToUserId: string | null;
  assignedToOrgUnitId: string | null;
  dueDate: string | null;
  completedAt: string | null;
  completedByUserId: string | null;
  completionNotes: string | null;
  createdAt: string;
};

export type HseRecordDetail = {
  record: HseRecord;
  personsInvolved: HsePersonInvolved[];
  followUps: HseFollowUp[];
  status: { stepCode: string | null; stepName: string | null; instanceStatus: string } | null;
  availableActions: { actionCode: string; name: string; toStepCode: string }[];
};

export type HseRecordQuery = {
  recordType?: string;
  categoryCode?: string;
  severityCode?: string;
  organizationUnitId?: string;
  projectId?: string;
  siteId?: string;
  reportedByUserId?: string;
  responsibleUserId?: string;
  occurredFrom?: string;
  occurredTo?: string;
  search?: string;
};

export type ReportHseRecordBody = {
  recordType: HseRecordType;
  categoryCode?: string | null;
  severityCode?: string | null;
  occurredAt: string;
  title: string;
  summary?: string | null;
  description?: string | null;
  immediateAction?: string | null;
  organizationUnitId?: string | null;
  projectId?: string | null;
  siteId?: string | null;
  locationDetail?: string | null;
  responsibleUserId?: string | null;
  responsibleOrgUnitId?: string | null;
};

export type UpdateHseRecordBody = {
  categoryCode?: string | null;
  severityCode?: string | null;
  occurredAt?: string;
  title?: string;
  summary?: string | null;
  description?: string | null;
  immediateAction?: string | null;
  organizationUnitId?: string | null;
  projectId?: string | null;
  siteId?: string | null;
  locationDetail?: string | null;
  responsibleUserId?: string | null;
  responsibleOrgUnitId?: string | null;
};

export type AddHsePersonBody = {
  employeeId?: string | null;
  personName?: string | null;
  personRole?: string | null;
};

export type CreateHseFollowUpBody = {
  title: string;
  description?: string | null;
  assignedToUserId?: string | null;
  assignedToOrgUnitId?: string | null;
  dueDate?: string | null;
};

export type CompleteHseFollowUpBody = {
  completionNotes?: string | null;
};

// --- Asset types (Phase 5) ---------------------------------------------

export type AssetStatusValue = "in_use" | "idle" | "retired" | "disposed";

export type AssetRecord = {
  id: string;
  assetNumber: string;
  assetTag: string | null;
  name: string;
  description: string | null;
  category: string | null;
  status: AssetStatusValue;
  organizationUnitId: string | null;
  custodianEmployeeId: string | null;
  projectId: string | null;
  siteId: string | null;
  locationDetail: string | null;
  acquisitionReference: string | null;
  acquiredAt: string | null;
  version: number;
  retiredAt: string | null;
};

export type CustodianReference = {
  id: string;
  employeeNumber: string;
  fullName: string;
};

export type AssetMovementRecord = {
  id: string;
  assetId: string;
  sequence: number | null;
  movementType: "transfer" | "status_change";
  reason: string | null;
  effectiveDate: string | null;
  fromOrganizationUnitId: string | null;
  fromCustodianEmployeeId: string | null;
  fromProjectId: string | null;
  fromSiteId: string | null;
  fromLocationDetail: string | null;
  fromStatus: AssetStatusValue | null;
  toOrganizationUnitId: string | null;
  toCustodianEmployeeId: string | null;
  toProjectId: string | null;
  toSiteId: string | null;
  toLocationDetail: string | null;
  toStatus: AssetStatusValue | null;
  workflowInstanceId: string | null;
  appliedAt: string | null;
  createdAt: string;
};

export type AssetMovementView = {
  movement: AssetMovementRecord;
  status: { stepCode: string | null; stepName: string | null; instanceStatus: string } | null;
  availableActions: { actionCode: string; name: string; toStepCode: string }[];
};

export type AssetDetail = {
  asset: AssetRecord;
  custodian: CustodianReference | null;
  movements: AssetMovementRecord[];
  pendingMovement: AssetMovementView | null;
};

export type AssetListResult = {
  assets: AssetRecord[];
  custodians: CustodianReference[];
};

export type AssetQuery = {
  search?: string;
  category?: string;
  status?: string;
  organizationUnitId?: string;
  siteId?: string;
  custodianEmployeeId?: string;
  includeTerminal?: boolean;
};

export type CreateAssetBody = {
  name: string;
  assetTag?: string | null;
  description?: string | null;
  category?: string | null;
  status?: AssetStatusValue;
  organizationUnitId?: string | null;
  custodianEmployeeId?: string | null;
  projectId?: string | null;
  siteId?: string | null;
  locationDetail?: string | null;
  acquisitionReference?: string | null;
  acquiredAt?: string | null;
};

export type UpdateAssetBody = {
  assetTag?: string | null;
  name?: string;
  description?: string | null;
  category?: string | null;
  acquisitionReference?: string | null;
  acquiredAt?: string | null;
};

export type MoveAssetBody = {
  organizationUnitId?: string | null;
  custodianEmployeeId?: string | null;
  projectId?: string | null;
  siteId?: string | null;
  locationDetail?: string | null;
  reason?: string | null;
  effectiveDate?: string | null;
};

export type SiteRecord = {
  id: string;
  customerId: string;
  projectId: string | null;
  code: string;
  name: string;
  address: string | null;
  status: string;
};

export type ProjectRecord = {
  id: string;
  customerId: string;
  contractId: string | null;
  code: string;
  name: string;
  status: string;
};

// --- Supply Chain types (Phase 4) --------------------------------------

export type ScmItem = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  unitOfMeasure: string;
  isActive: boolean;
};

export type SupplierRecord = {
  id: string;
  code: string;
  name: string;
  category: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
};

export type StockBalanceRecord = {
  id: string;
  itemId: string;
  siteId: string | null;
  quantity: number;
  updatedAt: string;
};

export type StockMovementRecord = {
  id: string;
  itemId: string;
  siteId: string | null;
  movementType: "in" | "out";
  quantity: number;
  reference: string | null;
  note: string | null;
  purchaseOrderId: string | null;
  occurredAt: string;
};

export type StockMovementResult = {
  movement: StockMovementRecord;
  balance: StockBalanceRecord;
  line?: PurchaseOrderLineRecord;
};

export type PurchaseRequestRecord = {
  id: string;
  requestNumber: string;
  organizationUnitId: string | null;
  justification: string;
  requiredDate: string | null;
  workflowInstanceId: string | null;
  convertedPurchaseOrderId: string | null;
};

export type PurchaseRequestLineRecord = {
  id: string;
  itemId: string;
  quantity: number;
  note: string | null;
};

export type PurchaseRequestDetail = {
  request: PurchaseRequestRecord;
  lines: PurchaseRequestLineRecord[];
  status: { stepCode: string | null; stepName: string | null; instanceStatus: string } | null;
  availableActions: { actionCode: string; name: string; toStepCode: string }[];
};

export type PurchaseOrderRecord = {
  id: string;
  orderNumber: string;
  supplierId: string;
  purchaseRequestId: string | null;
  currency: string | null;
  expectedDate: string | null;
  issuedAt: string | null;
  cancelledAt: string | null;
};

export type PurchaseOrderLineRecord = {
  id: string;
  itemId: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitPrice: number | null;
};

export type PurchaseOrderDetail = {
  order: PurchaseOrderRecord;
  lines: PurchaseOrderLineRecord[];
  supplier: SupplierRecord | null;
  state: string;
};

// --- Workforce types (Phase 3) -----------------------------------------

export type PositionRecord = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
};

export type Employee = {
  id: string;
  employeeNumber: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  employmentType: string | null;
  employmentStatus: "active" | "inactive" | "ended";
  joinedAt: string | null;
  endedAt: string | null;
  legalEntityId: string | null;
  organizationUnitId: string | null;
  positionId: string | null;
  userId: string | null;
};

export type EmployeeAssignmentRecord = {
  id: string;
  legalEntityId: string | null;
  organizationUnitId: string | null;
  positionId: string | null;
  employmentStatus: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
};

export type EmployeeDetail = {
  employee: Employee;
  position: PositionRecord | null;
  history: EmployeeAssignmentRecord[];
};

// --- Service Operations types (Phase 2) --------------------------------

export type ServiceDefinition = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  isActive: boolean;
};

export type ServiceChecklistTemplateItem = {
  id: string;
  code: string;
  label: string;
  isRequired: boolean;
  sortOrder: number;
};

export type WorkRequest = {
  id: string;
  requestNumber: string;
  customerId: string;
  siteId: string | null;
  serviceDefinitionId: string;
  description: string;
  priority: string | null;
  requestedAt: string;
  convertedWorkOrderId: string | null;
  cancelledAt: string | null;
};

export type WorkRequestRow = { request: WorkRequest; state: string };

export type WorkOrder = {
  id: string;
  workOrderNumber: string;
  workRequestId: string | null;
  customerId: string;
  siteId: string | null;
  serviceDefinitionId: string;
  title: string;
  description: string | null;
  priority: string | null;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  dueAt: string | null;
  assignedToUserId: string | null;
  startedAt: string | null;
  completionNotes: string | null;
  completedAt: string | null;
  verificationNotes: string | null;
  verifiedAt: string | null;
  workflowInstanceId: string | null;
};

export type WorkOrderChecklistItem = {
  id: string;
  code: string;
  label: string;
  isRequired: boolean;
  sortOrder: number;
  isCompleted: boolean;
  note: string | null;
  completedAt: string | null;
};

export type WorkOrderStatus = {
  stepCode: string | null;
  stepName: string | null;
  instanceStatus: string;
  sla: { dueAt: string | null; slaHours: number | null } | null;
  assignment: { roleCode: string | null; userId: string | null; isMine: boolean } | null;
};

export type WorkOrderRow = { workOrder: WorkOrder; status: WorkOrderStatus | null };

export type WorkOrderDetail = {
  workOrder: WorkOrder;
  serviceDefinition: ServiceDefinition | null;
  checklist: WorkOrderChecklistItem[];
  status: WorkOrderStatus | null;
  availableActions: { actionCode: string; name: string; toStepCode: string }[];
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

export type ContractRecord = {
  id: string;
  customerId: string;
  code: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
};

export type CommercialService = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
};

export type CustomerServiceLink = {
  id: string;
  customerId: string;
  serviceId: string;
  contractId: string | null;
  projectId: string | null;
  siteId: string | null;
  internalPicUserId: string | null;
  status: string;
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

// --- Wave A1: Sales & Commercial Types --------------------------------------

export type PriceBookRecord = {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  currency: string;
  isStandard: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PriceBookEntryRecord = {
  id: string;
  tenantId: string;
  priceBookId: string;
  itemSku: string;
  unitPrice: number;
  minQuantity: number;
  maxQuantity: number | null;
  unitOfMeasure: string;
  createdAt: string;
  updatedAt: string;
};

export type OpportunityRecord = {
  id: string;
  tenantId: string;
  code: string;
  title: string;
  customerId: string;
  leadSource: string;
  stageCode: string;
  estimatedValue: number | null;
  currency: string;
  confidencePercent: number | null;
  targetCloseDate: string | null;
  outcome: string | null;
  outcomeReason: string | null;
  ownerUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OpportunityStageHistoryRecord = {
  id: string;
  opportunityId: string;
  fromStageCode: string | null;
  toStageCode: string;
  fromOutcome: string | null;
  toOutcome: string | null;
  outcomeReason: string | null;
  note: string | null;
  changedBy: string | null;
  changedAt: string;
};

export type OpportunityDetailRecord = {
  opportunity: OpportunityRecord;
  customer: Customer | null;
  stageHistory: OpportunityStageHistoryRecord[];
};

export type OpportunityPipelineSummary = {
  stageCode: string;
  count: number;
  totalEstimatedValue: number;
};

export type QuotationRecord = {
  id: string;
  tenantId: string;
  code: string;
  opportunityId: string | null;
  customerId: string;
  priceBookId: string | null;
  revisionNumber: number;
  status: string;
  totalAmount: number;
  currency: string;
  validUntil: string | null;
  issuedAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  withdrawnAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type QuotationItemRecord = {
  id: string;
  quotationId: string;
  itemSku: string | null;
  description: string;
  unitPrice: number;
  quantity: number;
  discountPercent: number;
  lineTotal: number;
  sortOrder: number;
};

export type QuotationDetailRecord = {
  quotation: QuotationRecord;
  customer: Customer | null;
  opportunity: OpportunityRecord | null;
  items: QuotationItemRecord[];
};

export type CreatePriceBookBody = {
  code: string;
  name: string;
  currency: string;
  isStandard?: boolean;
};

export type AddPriceBookEntryBody = {
  itemSku: string;
  unitPrice: number;
  minQuantity?: number;
  maxQuantity?: number | null;
  unitOfMeasure?: string;
};

export type CreateOpportunityBody = {
  code: string;
  title: string;
  customerId: string;
  leadSource?: string;
  stageCode?: string;
  estimatedValue?: number | null;
  currency?: string;
  confidencePercent?: number | null;
  targetCloseDate?: string | null;
};

export type CreateQuotationBody = {
  code: string;
  opportunityId?: string | null;
  customerId: string;
  priceBookId?: string | null;
  currency?: string;
  validUntil?: string | null;
  notes?: string | null;
  items: {
    itemSku?: string | null;
    description: string;
    unitPrice: number;
    quantity: number;
    discountPercent?: number;
  }[];
};

// --- Wave A1: Service Quality Advanced Types --------------------------------

export type SqCalendarWindow = {
  id?: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
};

export type SqHolidayRecord = {
  id: string;
  tenantId: string;
  calendarId: string;
  holidayDate: string;
  name: string;
  createdAt: string;
};

export type SqCalendarRecord = {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  timeZone: string;
  isContinuous: boolean;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SqSlaPolicyRecord = {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  calendarId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SqSlaRuleRecord = {
  id: string;
  tenantId: string;
  policyId: string;
  code: string;
  customerId: string | null;
  contractId: string | null;
  severityCode: string | null;
  categoryCode: string | null;
  responseMinutes: number | null;
  resolutionMinutes: number | null;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SqSlaTargetRecord = {
  id: string;
  tenantId: string;
  complaintId: string;
  policyId: string;
  ruleId: string;
  calendarId: string;
  frozenAt: string;
  responseDueAt: string | null;
  resolutionDueAt: string | null;
  responseMetAt: string | null;
  resolutionMetAt: string | null;
  responseBreached: boolean;
  resolutionBreached: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type SqSlaTargetState = {
  status: string;
  responseMet: boolean;
  resolutionMet: boolean;
  responseBreached: boolean;
  resolutionBreached: boolean;
};

export type SqSlaPerformanceSummary = {
  status: string;
  count: number;
  metResponseCount: number;
  metResolutionCount: number;
  breachedCount: number;
};

export type SqRcaCategoryRecord = {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SqRcaFindingRecord = {
  id: string;
  tenantId: string;
  complaintId: string;
  rootCauseCategoryId: string;
  analysisMethodCode: string | null;
  statement: string;
  evidenceSummary: string | null;
  isPrimary: boolean;
  identifiedBy: string | null;
  identifiedAt: string;
  createdAt: string;
};

export type SqCapaActionRecord = {
  id: string;
  tenantId: string;
  actionNumber: string;
  complaintId: string;
  rcaFindingId: string | null;
  actionType: "corrective" | "preventive";
  title: string;
  description: string | null;
  ownerUserId: string | null;
  dueDate: string | null;
  status: string;
  workflowInstanceId: string | null;
  completedAt: string | null;
  completedBy: string | null;
  completionNote: string | null;
  effectivenessVerdict: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  verificationNote: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SqCapaEffectivenessSummary = {
  status: string;
  count: number;
  effectiveCount: number;
  ineffectiveCount: number;
};

export type SqRecurrenceRuleRecord = {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  groupBy: string;
  windowDays: number;
  minimumOccurrences: number;
  customerId: string | null;
  severityCode: string | null;
  categoryCode: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SqRecurrenceCluster = {
  groupValue: string | null;
  occurrences: number;
  complaintIds: string[];
  firstOccurredAt: string;
  lastOccurredAt: string;
};

export type SqRecurrenceDetectionRecord = {
  rule: SqRecurrenceRuleRecord;
  windowDays: number;
  minimumOccurrences: number;
  clusters: SqRecurrenceCluster[];
};

export type SqAutomationRuleRecord = {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  triggerEvent: string;
  scoreThreshold: number | null;
  proposedAction: string;
  actionParameters: Record<string, unknown>;
  requiresApproval: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SqAutomationProposalRecord = {
  id: string;
  tenantId: string;
  ruleId: string;
  triggerEvent: string;
  sourceEntityId: string;
  proposedAction: string;
  actionParameters: Record<string, unknown>;
  status: string;
  requiresApproval: boolean;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  appliedAt: string | null;
  failureReason: string | null;
  createdAt: string;
};

export type CreateSqCalendarBody = {
  code: string;
  name: string;
  timeZone: string;
  isContinuous?: boolean;
  isDefault?: boolean;
  windows: { dayOfWeek: number; startMinute: number; endMinute: number }[];
};

export type CreateSqSlaPolicyBody = {
  code: string;
  name: string;
  description?: string | null;
  calendarId: string;
};

export type CreateSqSlaRuleBody = {
  policyId: string;
  code: string;
  customerId?: string | null;
  contractId?: string | null;
  severityCode?: string | null;
  categoryCode?: string | null;
  responseMinutes?: number | null;
  resolutionMinutes?: number | null;
  priority?: number;
};

export type CreateSqRcaCategoryBody = {
  code: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  sortOrder?: number;
};

export type CreateSqRcaFindingBody = {
  rootCauseCategoryId: string;
  analysisMethodCode?: string | null;
  statement: string;
  evidenceSummary?: string | null;
  isPrimary?: boolean;
  identifiedBy?: string | null;
};

export type CreateSqCapaActionBody = {
  complaintId: string;
  rcaFindingId?: string | null;
  actionType: "corrective" | "preventive";
  title: string;
  description?: string | null;
  ownerUserId?: string | null;
  dueDate?: string | null;
};

export type CreateSqRecurrenceRuleBody = {
  code: string;
  name: string;
  description?: string | null;
  groupBy: string;
  windowDays: number;
  minimumOccurrences: number;
  customerId?: string | null;
  severityCode?: string | null;
  categoryCode?: string | null;
};

export type CreateSqAutomationRuleBody = {
  code: string;
  name: string;
  description?: string | null;
  triggerEvent: string;
  scoreThreshold?: number | null;
  proposedAction: string;
  actionParameters?: Record<string, unknown>;
};

