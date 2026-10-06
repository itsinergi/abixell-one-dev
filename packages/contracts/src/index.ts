/**
 * Shared TypeScript contracts between apps/api and apps/web.
 *
 * This package exports common DTOs, types, and error envelopes that cross
 * API↔Web boundaries. Populated starting Checkpoint 0B (Track A execution,
 * BN-06) with foundational Tenant/Organization/User/Role/RBAC DTOs shared
 * across both apps.
 *
 * Architecture rule (NFR-017): Kontrak antar modul harus typed dan lintas-konteks
 * import dilarang. Each type is re-exported from @abixell-one/contracts; neither
 * app re-defines it locally.
 *
 * Expansion: Future WPs may add domain-specific DTOs (BP, AP, etc.) as they
 * implement cross-app integration. For now (Checkpoint 0B), this captures the
 * essential login, navigation, and role-assignment surface.
 */

// ============================================================================
// ERROR ENVELOPE
// ============================================================================

/**
 * Standard API error response envelope. All HTTP error responses from the API
 * have this shape; the web client parses it via `data.error ?? "Request failed"`.
 */
export interface ApiErrorResponse {
  error: string;
}

/**
 * ApiError class — web-side exception for failed requests.
 * Thrown by the @abixell-one/web request helper when response.ok is false.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ============================================================================
// AUTHENTICATION & SESSION
// ============================================================================

/**
 * Successful login response (status: "authenticated").
 * Contains tokens, user ID, tenant context, and server-side session reference.
 */
export interface LoginSuccess {
  status: "authenticated";
  accessToken: string;
  refreshToken: string;
  userId: string;
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  /** Epic 1 (§4.1 B): server-side session reference. Access token names the
   * session; the session carries active Role. Role switching reuses the same
   * token and session ID. */
  sessionId: string;
}

/**
 * Tenant selection required response (status: "tenant_selection_required").
 * Returned when verified email exists in multiple tenants. Client re-submits
 * email+password with chosen tenantId.
 */
export interface TenantSelectionRequired {
  status: "tenant_selection_required";
  tenants: { tenantId: string; tenantCode: string; tenantName: string }[];
}

/**
 * Login result discriminated union: either successful auth or tenant selection.
 */
export type LoginResult = LoginSuccess | TenantSelectionRequired;

// ============================================================================
// NAVIGATION & MENU
// ============================================================================

/**
 * One node of the server-served navigation catalogue (Epic 1 §4.3).
 * Represents both folders (Grup/Modul, isSummary=true, no path) and leaf
 * menu items (isSummary=false, path set). Includes lock status for Wave 2+
 * module restrictions.
 */
export interface MenuNode {
  code: string;
  name: string;
  description?: string;
  /** true = folder (Grup, Modul) with children; false = leaf item. */
  isSummary: boolean;
  moduleCode?: string;
  /** Route this menu opens; present only for leaf items (not folders). */
  path?: string;
  isExternalAllowed: boolean;
  requiredPermissions: string[];
  seqNo: number;
  children: MenuNode[];
  /** Wave 2: caller's role cannot open this page; server sent it disabled
   * with reason instead of hiding. Browser reads as-is, never decides. */
  locked?: boolean;
  lockedReason?: string;
}

// ============================================================================
// ROLE & SCOPE ASSIGNMENT
// ============================================================================

/**
 * One role+scope pair assigned to the current user.
 * Drives the post-login "select role & site" screen. Mirrors the backend
 * role-assignment projection.
 */
export interface MyRoleAssignment {
  id: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  scopeType: "tenant" | "organization_unit" | "customer";
  scopeOrganizationUnitId: string | null;
  scopeOrganizationUnitName: string | null;
  scopeCustomerId: string | null;
  scopeCustomerName: string | null;
}

// ============================================================================
// RECORD TYPES (MASTER DATA)
// ============================================================================

/**
 * Tenant — the workspace / data boundary (Epic 5 Gelombang 1 §4.5).
 * NOT the company profile; the Legal Entity is the official identity.
 * Tenant carries defaults (timezone, locale, currency) and admin contact.
 */
export interface Tenant {
  id: string;
  code: string;
  name: string;
  status: string;
  defaultTimezone: string | null;
  defaultLocale: string | null;
  defaultCurrency: string | null;
  contactAdminName: string | null;
  contactAdminEmail: string | null;
  contactAdminPhone: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * User record — platform identity (tenanted, email unique per-tenant).
 */
export interface User {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  status: string;
  deactivatedAt: Date | null;
  deactivatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Organization Unit — node in the org hierarchy (tenant-scoped, mutable).
 * Can be a department, team, cost center, or entity. Minimal surface for
 * role-scope binding and hierarchy traversal.
 */
export interface OrganizationUnit {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  type: string; // "department", "team", "cost_center", "entity", etc.
  parentId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Legal Entity — official company identity (tenant-scoped, referenced by
 * financial/procurement records). Minimal surface for BP canonical refs.
 */
export interface LegalEntity {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// ROLE & PERMISSION (CORE RBAC)
// ============================================================================

/**
 * Role — named bundle of permissions. Assigned to users in scopes.
 * Minimal surface; actual permission resolution happens server-side.
 */
export interface Role {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description?: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Permission — atomic action capability (e.g., "business_partner.create").
 * Assigned to roles; evaluated at request time with scope filtering.
 */
export interface Permission {
  id?: string;
  code: string;
  description: string;
}

// All types above are individually exported at declaration (export interface /
// export type / export class) — no re-export block needed.
