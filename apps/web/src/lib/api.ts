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
