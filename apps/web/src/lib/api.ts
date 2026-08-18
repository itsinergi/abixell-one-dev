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
};
